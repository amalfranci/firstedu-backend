import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import cron from 'node-cron';
import connectDB from './config/db.js';
import './config/firebase.js';
import app from './app.js';
import { setupSupportSocket } from './socket/supportSocket.js';
import { setupExamSessionSocket } from './socket/examSessionSocket.js';
import { setupChallengeSocket } from './socket/challengeSocket.js';
import { setupTeacherChatSocket } from './socket/teacherChatSocket.js';
import { setupTeacherCallSocket } from './socket/teacherCallSocket.js';
import { logAgoraRecordingStatus } from './services/agoraCloudRecording.service.js';
import { setIO } from './socket/socketGateway.js';
import examSessionService from './services/examSession.service.js';
import tournamentNotificationsService from './services/tournamentNotifications.service.js';
import olympiadNotificationsService from './services/olympiadNotifications.service.js';
import workshopNotificationsService from './services/workshopNotifications.service.js';
import liveCompetitionNotificationsService from './services/liveCompetitionNotifications.service.js';
import everydayChallengeCronService from './services/everydayChallengeCron.service.js';
import studentEverydayChallengeCronService from './services/studentEverydayChallengeCron.service.js';
import { isCorsOriginAllowed } from './utils/corsOrigin.js';
import os from 'os';

dotenv.config();

const startServer = async () => {
  try {
    await connectDB();

    // Generation for paper jobs runs in a dedicated worker by default.
    // Only fail in-process (inline) jobs on API restart — worker jobs stay pending.
    try {
      const { failOrphanedGenerationJobs } = await import(
        './services/questionBankGenerationJobStore.js'
      );
      failOrphanedGenerationJobs(
        'API server restarted during in-process generation. Resume to continue from locked questions — already spent tokens are kept.',
        { onlyRunners: ['inline'] }
      );
    } catch (err) {
      console.warn(
        '[ai-qb] orphan job cleanup skipped:',
        err?.message || err
      );
    }

    const server = http.createServer(app);

    // Setup Socket.io
    const io = new Server(server, {
      pingTimeout: Number(process.env.SOCKET_IO_PING_TIMEOUT_MS || 30000),
      pingInterval: Number(process.env.SOCKET_IO_PING_INTERVAL_MS || 25000),
      maxHttpBufferSize: Number(
        process.env.SOCKET_IO_MAX_HTTP_BUFFER_SIZE || 50 * 1024 * 1024
      ),
      connectionStateRecovery: {
        maxDisconnectionDuration: Number(process.env.SOCKET_IO_RECOVERY_MS || 120000),
        skipMiddlewares: false,
      },
      cors: {
        origin: (origin, callback) => {
          if (isCorsOriginAllowed(origin)) {
            callback(null, true);
          } else {
            callback(new Error('CORS not allowed'));
          }
        },
        credentials: true,
        methods: ["GET", "POST"],
      },
    });
    setIO(io);

    // Setup support socket namespace
    setupSupportSocket(io);

    // Setup exam session socket namespace (for real-time proctoring)
    setupExamSessionSocket(io);
    setupChallengeSocket(io);
    setupTeacherChatSocket(io);
    setupTeacherCallSocket(io);

    // ==================== HYBRID AUTO-SUBMISSION APPROACH ====================
    // 
    // ⏱️ TIME-BASED: REST API + Background Job (Cron)
    //    - Cron job runs every minute to check for expired sessions
    //    - Also checks on REST API calls (getExamSession)
    //    - Emits WebSocket notifications when sessions are auto-submitted
    //
    // 🚨 PROCTORING-BASED: WebSocket (Real-time)
    //    - Instant detection and auto-submission via WebSocket
    //    - REST API endpoint still available as fallback
    //    - See examSessionSocket.js for WebSocket handlers
    //
    // ========================================================================
    
    // Setup cron job to auto-submit expired exam sessions
    // Runs every minute to check for expired sessions
    cron.schedule('* * * * *', async () => {
      try {
        const result = await examSessionService.autoSubmitExpiredSessions();
        if (result.processed > 0) {
          console.log(`⏰ Auto-submission cron: ${result.message}`);

          if (result.autoSubmittedSessions && result.autoSubmittedSessions.length > 0) {
            const examNamespace = io.of("/exam");
            result.autoSubmittedSessions.forEach(({ sessionId, studentId }) => {
              examNamespace.to(`session:${sessionId}`).emit("exam_auto_submitted", {
                sessionId,
                reason: "time_expired",
                message: "Exam was auto-submitted due to time expiration",
                timestamp: new Date(),
              });
              console.log(`📡 WebSocket notification sent for auto-submitted session ${sessionId}`);
            });
          }
        }
      } catch (error) {
        console.error('❌ Error in auto-submit cron job:', error);
      }
      try {
        await tournamentNotificationsService.runTournamentNotificationTick();
      } catch (error) {
        console.error('❌ Error in tournament notifications cron:', error);
      }
      try {
        await olympiadNotificationsService.runOlympiadNotificationTick();
      } catch (error) {
        console.error('❌ Error in olympiad notifications cron:', error);
      }
      try {
        await workshopNotificationsService.runWorkshopNotificationTick();
      } catch (error) {
        console.error('❌ Error in workshop notifications cron:', error);
      }
      try {
        await liveCompetitionNotificationsService.runLiveCompetitionCronTick();
      } catch (error) {
        console.error('❌ Error in live competition cron:', error);
      }
    });
    console.log('⏰ Minute cron: auto-submit + tournament + olympiad + workshop + live-competition notifications');

    // Setup daily cron for Everyday Challenge (Runs every day at 9:00 AM)
    cron.schedule('0 9 * * *', async () => {
      try {
        await everydayChallengeCronService.runEverydayChallengeCronTick();
      } catch (error) {
        console.error('❌ Error in everyday challenge admin cron:', error);
      }
    });
    console.log('⏰ Daily cron (9 AM): everyday challenge admin notifications');

    // Setup morning cron for Student Everyday Challenge Reminders (Runs every day at 8:00 AM)
    cron.schedule('0 8 * * *', async () => {
      try {
        await studentEverydayChallengeCronService.runStudentEverydayChallengeReminders(true);
      } catch (error) {
        console.error('❌ Error in student morning everyday challenge cron:', error);
      }
    });
    console.log('⏰ Daily cron (8 AM): student everyday challenge morning reminders');

    // Setup evening cron for Student Everyday Challenge Reminders (Runs every day at 6:00 PM)
    cron.schedule('0 18 * * *', async () => {
      try {
        await studentEverydayChallengeCronService.runStudentEverydayChallengeReminders(false);
      } catch (error) {
        console.error('❌ Error in student evening everyday challenge cron:', error);
      }
    });
    console.log('⏰ Daily cron (6 PM): student everyday challenge evening reminders');

    const port = process.env.PORT || 8001;
    const host = process.env.HOST || '127.0.0.1';

    const requestTimeoutMs = Math.max(
        60_000,
        Number(process.env.AI_QB_REQUEST_TIMEOUT_MS) || 30 * 60 * 1000
    );

    // Increase timeouts for large file uploads and long AI generation pipelines
    server.timeout = requestTimeoutMs;
    server.headersTimeout = requestTimeoutMs;
    server.keepAliveTimeout = requestTimeoutMs;
    server.requestTimeout = requestTimeoutMs;

    server.listen(port, host, () => {
      const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const bindUrl = host === '0.0.0.0' ? `http://localhost:${port}` : `http://${host}:${port}`;
      console.log(`🚀 Server ready at ${when}`);
      console.log(`   ${bindUrl}`);
      console.log(`📡 Socket.io server initialized`);
      logAgoraRecordingStatus();
      if (host === '0.0.0.0') {
        const lanIps = [];
        for (const iface of Object.values(os.networkInterfaces())) {
          for (const cfg of iface || []) {
            if (cfg.family === 'IPv4' && !cfg.internal) {
              lanIps.push(cfg.address);
            }
          }
        }
        if (lanIps.length) {
          console.log(`📱 Share API with Wi‑Fi devices: ${lanIps.map(ip => `http://${ip}:${port}`).join(', ')}`);
        }
      }
    });
  } catch (err) {
    console.error('Server startup failed:', err);
    process.exit(1);
  }
};
startServer();
