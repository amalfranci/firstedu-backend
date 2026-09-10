import mongoose from "mongoose";
import LiveCompetition from "../models/LiveCompetition.js";
import LiveCompetitionSubmission from "../models/LiveCompetitionSubmission.js";
import LiveCompetitionNotificationLog from "../models/LiveCompetitionNotificationLog.js";
import liveCompetitionRepository from "../repository/liveCompetition.repository.js";
import studentRepository from "../repository/student.repository.js";
import { sendNotificationToMultipleStudents } from "./notification.service.js";
import {
  sendEventStartReminderEmail,
  sendEventStartEmail,
  sendEmailWithTemplate,
} from "../utils/sendEmail.js";
import walletService from "./wallet.service.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const WINDOW_MS   = 4 * 60 * 1000; // 4-minute grace period around cron tick

// ─── DB-persisted deduplication (replaces unreliable in-memory Set) ──────────

const tryLogNotification = async (eventId, kind) => {
  try {
    await LiveCompetitionNotificationLog.create({ event: eventId, kind });
    return true;
  } catch (e) {
    if (e?.code === 11000) return false; // already sent
    throw e;
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns all COMPLETED-payment Round-1 participants as full student objects.
 * Filters to students who have an email address.
 */
const getRound1Students = async (eventId) => {
  const submissions = await LiveCompetitionSubmission.find({
    event: eventId,
    round: "MEGA_AUDITION",
    paymentStatus: "COMPLETED",
  })
    .select("participant")
    .lean();

  const ids = [
    ...new Set(submissions.map((s) => s.participant?.toString()).filter(Boolean)),
  ];
  if (ids.length === 0) return [];

  const { students = [] } = await studentRepository.findAll(
    { _id: { $in: ids } },
    { limit: 5000 }
  );
  return students.filter((s) => s.email);
};

/**
 * Returns all COMPLETED-payment Round-2 students as full student objects.
 * Filters to students who have an email address.
 */
const getRound2Students = async (eventId) => {
  const subs = await LiveCompetitionSubmission.find({
    event: eventId,
    round: "GRAND_FINALE",
    paymentStatus: "COMPLETED",
  })
    .select("participant")
    .lean();

  const ids = [
    ...new Set(subs.map((s) => s.participant?.toString()).filter(Boolean)),
  ];
  if (ids.length === 0) return [];

  const { students = [] } = await studentRepository.findAll(
    { _id: { $in: ids } },
    { limit: 5000 }
  );
  return students.filter((s) => s.email);
};

/**
 * Returns all COMPLETED-payment Round-2 submissions (with rank/isWinner).
 */
const getRound2Submissions = async (eventId) => {
  return LiveCompetitionSubmission.find({
    event: eventId,
    round: "GRAND_FINALE",
    paymentStatus: "COMPLETED",
  })
    .select("participant rank isWinner")
    .lean();
};

// ─── 30-min Reminder ─────────────────────────────────────────────────────────

const notifyReminder = async (event) => {
  const logged = await tryLogNotification(event._id.toString(), "start_reminder_11");
  if (!logged) return;

  const students = await getRound1Students(event._id);
  const studentIds = students.map((s) => s._id?.toString() || s._id).filter(Boolean);

  if (studentIds.length > 0) {
    const title = `${event.title} starts in 10 mins! ⏰`;
    const body  = `The Live Competition "${event.megaAudition?.title || event.title}" starts in 10 minutes. Get ready!`;
    await sendNotificationToMultipleStudents(studentIds, title, body, {
      type:             "event",
      eventId:          event._id.toString(),
      notificationKind: "live_competition_start_reminder",
    }, null);
  }

  // Email — fire-and-forget
  setImmediate(async () => {
    try {
      for (const s of students) {
        await sendEventStartReminderEmail({
          email:     s.email,
          name:      s.name,
          eventName: event.megaAudition?.title || event.title,
          eventType: "live_competition",
          startTime: event.megaAudition?.eventWindow?.start,
        });
      }
      console.log(
        `[LiveCompEmail] 📧 11-min reminder emails sent for "${event.title}" to ${students.length} students.`
      );
    } catch (err) {
      console.error(`[LiveCompEmail] Error sending reminder emails for "${event.title}":`, err);
    }
  });
};

// ─── Round 1 Event Start ─────────────────────────────────────────────────────

const notifyStart = async (event) => {
  const logged = await tryLogNotification(event._id.toString(), "start");
  if (!logged) return;

  const students = await getRound1Students(event._id);
  const studentIds = students.map((s) => s._id?.toString() || s._id).filter(Boolean);

  if (studentIds.length > 0) {
    const title = `${event.title} is now LIVE! 🎉`;
    const body  = `Round 1 "${event.megaAudition?.title || event.title}" has officially started. Submit your entry now!`;
    await sendNotificationToMultipleStudents(studentIds, title, body, {
      type:             "event",
      eventId:          event._id.toString(),
      notificationKind: "live_competition_start",
    }, null);
  }

  // Email — fire-and-forget
  setImmediate(async () => {
    try {
      for (const s of students) {
        await sendEventStartEmail({
          email:     s.email,
          name:      s.name,
          eventName: event.megaAudition?.title || event.title,
          eventType: "live_competition",
          startTime: event.megaAudition?.eventWindow?.start,
        });
      }
      console.log(
        `[LiveCompEmail] 📧 Round 1 start emails sent for "${event.title}" to ${students.length} students.`
      );
    } catch (err) {
      console.error(`[LiveCompEmail] Error sending Round 1 start emails for "${event.title}":`, err);
    }
  });
};

// ─── Grand Finale (Round 2) — 30-min Reminder ─────────────────────────────────

const notifyGrandFinaleReminder = async (event) => {
  const logged = await tryLogNotification(event._id.toString(), "gf_start_reminder_11");
  if (!logged) return;

  const students   = await getRound2Students(event._id);
  const studentIds = students.map((s) => s._id?.toString() || s._id).filter(Boolean);

  if (studentIds.length > 0) {
    const title = `${event.title} — Grand Finale starts in 10 mins! ⏰`;
    const body  = `Round 2 "${event.grandFinale?.title || "Grand Finale"}" starts in 10 minutes. Get ready to compete!`;
    await sendNotificationToMultipleStudents(studentIds, title, body, {
      type:             "event",
      eventId:          event._id.toString(),
      notificationKind: "live_competition_gf_start_reminder",
    }, null);
  }

  // Email — fire-and-forget
  setImmediate(async () => {
    try {
      for (const s of students) {
        await sendEventStartReminderEmail({
          email:     s.email,
          name:      s.name,
          eventName: `${event.title} — ${event.grandFinale?.title || "Grand Finale"}`,
          eventType: "live_competition",
          startTime: event.grandFinale?.eventWindow?.start,
        });
      }
      console.log(
        `[LiveCompEmail] 📧 Grand Finale 11-min reminder emails sent for "${event.title}" to ${students.length} students.`
      );
    } catch (err) {
      console.error(`[LiveCompEmail] Error sending Grand Finale reminder emails for "${event.title}":`, err);
    }
  });
};

// ─── Grand Finale (Round 2) — Event Start ────────────────────────────────────

const notifyGrandFinaleStart = async (event) => {
  const logged = await tryLogNotification(event._id.toString(), "gf_start");
  if (!logged) return;

  const students   = await getRound2Students(event._id);
  const studentIds = students.map((s) => s._id?.toString() || s._id).filter(Boolean);

  if (studentIds.length > 0) {
    const title = `${event.title} — Grand Finale is LIVE! 🏆`;
    const body  = `Round 2 "${event.grandFinale?.title || "Grand Finale"}" has officially started. Submit your Grand Finale entry now!`;
    await sendNotificationToMultipleStudents(studentIds, title, body, {
      type:             "event",
      eventId:          event._id.toString(),
      notificationKind: "live_competition_gf_start",
    }, null);
  }

  // Email — fire-and-forget
  setImmediate(async () => {
    try {
      for (const s of students) {
        await sendEventStartEmail({
          email:     s.email,
          name:      s.name,
          eventName: `${event.title} — ${event.grandFinale?.title || "Grand Finale"}`,
          eventType: "live_competition",
          startTime: event.grandFinale?.eventWindow?.start,
        });
      }
      console.log(
        `[LiveCompEmail] 📧 Grand Finale start emails sent for "${event.title}" to ${students.length} students.`
      );
    } catch (err) {
      console.error(`[LiveCompEmail] Error sending Grand Finale start emails for "${event.title}":`, err);
    }
  });
};

// ─── Round 1 Result ──────────────────────────────────────────────────────────

/**
 * Send a personalized HTML email to a qualified student.
 */
const sendRound1QualifiedEmail = async ({
  student,
  event,
}) => {
  const displayId = student.phone || student._id.toString().slice(-8).toUpperCase();
  const round1Title = event.megaAudition?.title || event.title;
  const round2Title = event.grandFinale?.title || "Grand Finale";

  await sendEmailWithTemplate({
    to:       student.email,
    category: "event_notifications",
    slug:     "live_competition_round1_qualified",
    variables: {
      name:         student.name || "Student",
      eventName:    round1Title,
      round2Title:  round2Title,
      displayId:    displayId,
    },
    defaultSubject: `🎉 You Qualified for Round 2 — ${event.title}`,
    defaultHtml: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:30px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:26px;">🎉 Congratulations! You Qualified!</h1>
        </div>
        <div style="padding:28px 24px;">
          <p style="color:#333;font-size:16px;margin-top:0;">Congratulations <strong>${student.name || "Student"}</strong> (ID: <strong>${displayId}</strong>)!</p>
          <p style="color:#555;font-size:15px;">
            You have successfully passed <strong>${round1Title}</strong> and are officially invited to <strong>${round2Title}</strong> of <strong>${event.title}</strong>!
          </p>
          <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:16px;border-radius:4px;margin:20px 0;">
            <p style="margin:0;color:#166534;font-weight:600;">Next Step: ${round2Title} Registration</p>
            <p style="margin:8px 0 0;color:#15803d;font-size:14px;">
              Please open the app to complete your registration within the payment window.
            </p>
          </div>
          <p style="color:#888;font-size:13px;margin-top:24px;">Best of luck! 🌟</p>
        </div>
        <div style="background:#f5f5f5;padding:16px 24px;text-align:center;">
          <p style="color:#aaa;font-size:12px;margin:0;">TestLard — Empowering Every Learner</p>
        </div>
      </div>
    `,
  });
};

/**
 * Email to students who did NOT qualify for Round 2.
 */
const sendRound1NotQualifiedEmail = async ({ student, event }) => {
  await sendEmailWithTemplate({
    to:       student.email,
    category: "event_notifications",
    slug:     "live_competition_round1_not_qualified",
    variables: {
      name:      student.name || "Student",
      eventName: event.megaAudition?.title || event.title,
    },
    defaultSubject: `📊 Round 1 Results — ${event.title}`,
    defaultHtml: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);padding:30px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:26px;">📊 Round 1 Results Are Live!</h1>
        </div>
        <div style="padding:28px 24px;">
          <p style="color:#333;font-size:16px;margin-top:0;">Hi <strong>${student.name || "Student"}</strong>,</p>
          <p style="color:#555;font-size:15px;">
            Thank you for participating in <strong>${event.megaAudition?.title || event.title}</strong>
            of <strong>${event.title}</strong>.
          </p>
          <p style="color:#555;font-size:15px;">
            The results have been declared. Unfortunately, you did not qualify for the Grand Finale
            this time. Keep practicing and we hope to see you at the next competition!
          </p>
          <div style="background:#f9f9f9;border-left:4px solid #f5576c;padding:16px;border-radius:4px;margin:20px 0;">
            <p style="margin:0;color:#555;font-style:italic;">
              "Every competition is a step forward. Don't give up — your best performance is yet to come! 🌟"
            </p>
          </div>
          <p style="color:#888;font-size:13px;margin-top:24px;">Open the app to view the full leaderboard.</p>
        </div>
        <div style="background:#f5f5f5;padding:16px 24px;text-align:center;">
          <p style="color:#aaa;font-size:12px;margin:0;">TestLard — Empowering Every Learner</p>
        </div>
      </div>
    `,
  });
};

// ─── Round 2 (Grand Finale) Result ───────────────────────────────────────────

/**
 * Email for Grand Finale result — includes rank prominently.
 */
const sendRound2ResultEmail = async ({ student, event, rank, isWinner }) => {
  const rankDisplay = rank ? `#${rank}` : "—";
  const winnerBadge = isWinner
    ? `<div style="text-align:center;margin:20px 0;">
        <span style="background:#fef3c7;color:#92400e;padding:8px 20px;border-radius:20px;font-weight:700;font-size:14px;">🏆 WINNER</span>
       </div>`
    : "";

  await sendEmailWithTemplate({
    to:       student.email,
    category: "event_notifications",
    slug:     "live_competition_round2_result",
    variables: {
      name:      student.name || "Student",
      eventName: event.grandFinale?.title || event.title,
      rank:      rankDisplay,
    },
    defaultSubject: `🏆 Grand Finale Results — ${event.title}`,
    defaultHtml: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#f6d365 0%,#fda085 100%);padding:30px 24px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:26px;">🏆 Grand Finale Results Are Live!</h1>
        </div>
        <div style="padding:28px 24px;">
          <p style="color:#333;font-size:16px;margin-top:0;">Hi <strong>${student.name || "Student"}</strong>,</p>
          <p style="color:#555;font-size:15px;">
            The final results for <strong>${event.grandFinale?.title || event.title}</strong> (Grand Finale)
            of <strong>${event.title}</strong> have been declared!
          </p>
          ${winnerBadge}
          <div style="background:#fff;border:1px solid #eee;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
            <h3 style="margin-top:0;color:#333;">Your Final Ranking</h3>
            <span style="display:block;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;">Rank</span>
            <span style="display:block;font-size:48px;font-weight:bold;color:${isWinner ? "#f6d365" : "#667eea"};">${rankDisplay}</span>
          </div>
          <div style="background:#f9f9f9;border-left:4px solid #fda085;padding:16px;border-radius:4px;margin:20px 0;">
            <p style="margin:0;color:#555;font-style:italic;">
              "Regardless of the outcome, every competition makes you stronger. Keep going! 🌟"
            </p>
          </div>
          <p style="color:#888;font-size:13px;margin-top:24px;">Open the app to view the complete results and leaderboard.</p>
        </div>
        <div style="background:#f5f5f5;padding:16px 24px;text-align:center;">
          <p style="color:#aaa;font-size:12px;margin:0;">TestLard — Empowering Every Learner</p>
        </div>
      </div>
    `,
  });
};

// ─── Auto-declare Round 1 result ─────────────────────────────────────────────

const autoDeclareMegaAuditionResult = async (event) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    let updatePayload = { "megaAudition.status": "RESULT_DECLARED" };

    // Unlock Grand Finale if its payment window has opened
    if (event.grandFinale?.paymentWindow?.start) {
      if (new Date() >= new Date(event.grandFinale.paymentWindow.start)) {
        updatePayload["grandFinale.status"] = "UPCOMING";
      }
    }

    await liveCompetitionRepository.updateEventById(event._id, updatePayload);
    await session.commitTransaction();
    session.endSession();

    console.log(`[LiveCompCron] ✅ Round 1 result auto-declared for "${event.title}"`);

    // Notify + email — fire-and-forget
    setImmediate(async () => {
      try {
        // Fetch all Round 1 submissions
        const allSubs = await LiveCompetitionSubmission.find({
          event: event._id,
          round: "MEGA_AUDITION",
          paymentStatus: "COMPLETED",
        })
          .select("participant isQualified")
          .lean();

        const qualifiedIds   = allSubs.filter((s) => s.isQualified).map((s) => s.participant.toString());
        const notQualifiedIds = allSubs.filter((s) => !s.isQualified).map((s) => s.participant.toString());

        // ── Push notifications ──────────────────────────────────────────────
        if (qualifiedIds.length > 0) {
          await sendNotificationToMultipleStudents(
            qualifiedIds,
            "🎉 Round 1 Results — You Qualified!",
            `You've qualified for the Grand Finale of "${event.title}"! Check the app for details.`,
            { type: "live_competition_result", eventId: event._id.toString(), round: "MEGA_AUDITION", qualified: "true" },
            null
          );
        }
        if (notQualifiedIds.length > 0) {
          await sendNotificationToMultipleStudents(
            notQualifiedIds,
            `📊 Round 1 Results — ${event.title}`,
            `Round 1 results for "${event.title}" are now live. Open the app to view.`,
            { type: "live_competition_result", eventId: event._id.toString(), round: "MEGA_AUDITION", qualified: "false" },
            null
          );
        }

        // ── Emails ──────────────────────────────────────────────────────────
        const allIds = [...qualifiedIds, ...notQualifiedIds];
        if (allIds.length === 0) return;

        const { students: allStudents = [] } = await studentRepository.findAll(
          { _id: { $in: allIds } },
          { limit: 5000 }
        );

        const studentMap = new Map(allStudents.map((s) => [s._id.toString(), s]));

        // Send to qualifiers (personalized email)
        for (const id of qualifiedIds) {
          const s = studentMap.get(id);
          if (!s?.email) continue;
          try {
            await sendRound1QualifiedEmail({ student: s, event });
          } catch (e) {
            console.error(`[LiveCompEmail] Failed qualified email to ${s.email}:`, e.message);
          }
        }

        // Send to non-qualifiers
        for (const id of notQualifiedIds) {
          const s = studentMap.get(id);
          if (!s?.email) continue;
          try {
            await sendRound1NotQualifiedEmail({ student: s, event });
          } catch (e) {
            console.error(`[LiveCompEmail] Failed not-qualified email to ${s.email}:`, e.message);
          }
        }

        console.log(
          `[LiveCompEmail] 📧 Round 1 result emails sent for "${event.title}": ` +
          `${qualifiedIds.length} qualified, ${notQualifiedIds.length} not qualified.`
        );
      } catch (err) {
        console.error(`[LiveCompCron] Failed to send Round 1 notifications for "${event.title}":`, err);
      }
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(`[LiveCompCron] Failed to auto-declare Round 1 result for "${event.title}":`, err);
  }
};

// ─── Auto-declare Round 2 (Grand Finale) result ──────────────────────────────

const autoDeclareFinalResult = async (event) => {
  // Guard: Rank 1 winner must be assigned before auto-declaring
  const rank1Winner = await LiveCompetitionSubmission.findOne({
    event:    event._id,
    round:    "GRAND_FINALE",
    isWinner: true,
    rank:     1,
  }).lean();

  if (!rank1Winner) {
    console.warn(
      `[LiveCompCron] ⚠️ Grand Finale result declaration skipped for "${event.title}" — no Rank 1 winner assigned yet.`
    );
    return;
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    await liveCompetitionRepository.updateEventById(event._id, {
      "grandFinale.status": "RESULT_DECLARED",
    });
    await session.commitTransaction();
    session.endSession();

    console.log(`[LiveCompCron] ✅ Grand Finale result auto-declared for "${event.title}"`);

    // Notify + email — fire-and-forget
    setImmediate(async () => {
      try {
        const subs = await getRound2Submissions(event._id);
        const pIds = [...new Set(subs.map((s) => s.participant.toString()))];

        if (pIds.length > 0) {
          await sendNotificationToMultipleStudents(
            pIds,
            "🏆 Grand Finale Results Declared!",
            `Final results for "${event.title}" are now live. Check your rank in the app!`,
            { type: "live_competition_result", eventId: event._id.toString(), round: "GRAND_FINALE" },
            null
          );
        }

        // Credit wallets
        if (event.grandFinale?.prizes) {
          for (const s of subs) {
            if (s.isWinner && s.rank) {
              const prizeConfig = event.grandFinale.prizes.find(p => p.rank === s.rank);
              if (prizeConfig && prizeConfig.walletPoints > 0) {
                try {
                  await walletService.addRewardPoints(
                    s.participant.toString(),
                    prizeConfig.walletPoints,
                    "live_competition_win",
                    `Rank ${s.rank} - ${event.title}`,
                    event._id.toString(),
                    "LiveCompetition"
                  );
                } catch (e) {
                  console.error(`[LiveCompCron] Failed to credit wallet for ${s.participant}:`, e);
                }
              }
            }
          }
        }

        // Emails with rank
        const { students: allStudents = [] } = await studentRepository.findAll(
          { _id: { $in: pIds } },
          { limit: 5000 }
        );
        const studentMap = new Map(allStudents.map((s) => [s._id.toString(), s]));
        const rankMap    = new Map(subs.map((s) => [s.participant.toString(), { rank: s.rank, isWinner: s.isWinner }]));

        for (const id of pIds) {
          const s = studentMap.get(id);
          if (!s?.email) continue;
          const { rank, isWinner } = rankMap.get(id) || {};
          try {
            await sendRound2ResultEmail({ student: s, event, rank, isWinner });
          } catch (e) {
            console.error(`[LiveCompEmail] Failed Grand Finale email to ${s.email}:`, e.message);
          }
        }

        console.log(
          `[LiveCompEmail] 📧 Grand Finale result emails sent for "${event.title}" to ${pIds.length} students.`
        );
      } catch (err) {
        console.error(`[LiveCompCron] Failed to send Grand Finale notifications for "${event.title}":`, err);
      }
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(`[LiveCompCron] Failed to auto-declare Grand Finale result for "${event.title}":`, err);
  }
};

// ─── Single Optimized Cron Tick ───────────────────────────────────────────────
// One DB query per minute covers ALL conditions:
//   • R1 30-min reminder       • R1 start
//   • GF 30-min reminder       • GF start
//   • R1 result declaration    • GF result declaration
// Mirrors the pattern used by tournamentNotifications and olympiadNotifications.

export const runLiveCompetitionCronTick = async () => {
  const now = new Date();

  // ── Single DB query — all relevant events ─────────────────────────────────
  const events = await LiveCompetition.find({
    isPublished: true,
    $or: [
      // R1 
      { "megaAudition.eventWindow.start": { $gte: new Date(now.getTime() - WINDOW_MS), $lte: new Date(now.getTime() + 15 * 60 * 1000) } },
      // GF 
      { "grandFinale.eventWindow.start": { $gte: new Date(now.getTime() - WINDOW_MS), $lte: new Date(now.getTime() + 15 * 60 * 1000) } },
      // R1 — result declaration due
      { "megaAudition.status": "CLOSED", "megaAudition.resultDeclarationDate": { $gte: new Date(now.getTime() - WINDOW_MS), $lte: now } },
      // GF — result declaration due
      { "grandFinale.status": "CLOSED", "grandFinale.resultDeclarationDate": { $gte: new Date(now.getTime() - WINDOW_MS), $lte: now } },
      // External-link GF rounds can remain LIVE while results become due
      {
        "grandFinale.status": "LIVE",
        "grandFinale.submission.type": "EXTERNAL_LINK",
        "grandFinale.resultDeclarationDate": { $gte: new Date(now.getTime() - WINDOW_MS), $lte: now },
      },
    ],
  }).lean();

  for (const e of events) {
    // ── Round 1 (Mega Audition) ──────────────────────────────────────────────
    const r1Start = e.megaAudition?.eventWindow?.start;
    if (r1Start) {
      const r1Date = new Date(r1Start);
      if (!isNaN(r1Date.getTime())) {
        const timeToStartMs = r1Date.getTime() - now.getTime();
        
        // Reminder: ~11 minutes before
        const elevenMinsMs = 11 * 60 * 1000;
        if (timeToStartMs <= elevenMinsMs && timeToStartMs >= elevenMinsMs - WINDOW_MS) {
          await notifyReminder(e);
        }
        
        // Start: ~1 minute before
        const oneMinMs = 1 * 60 * 1000;
        if (timeToStartMs <= oneMinMs && timeToStartMs >= oneMinMs - WINDOW_MS) {
          await notifyStart(e);
        }
      }
    }

    // R1 result declaration
    if (e.megaAudition?.status === "CLOSED" && e.megaAudition?.resultDeclarationDate) {
      const rdDate = new Date(e.megaAudition.resultDeclarationDate);
      const timeSinceResultMs = now.getTime() - rdDate.getTime();
      if (timeSinceResultMs >= 0 && timeSinceResultMs <= WINDOW_MS) {
        await autoDeclareMegaAuditionResult(e);
      }
    }

    // ── Round 2 (Grand Finale) ───────────────────────────────────────────────
    const gfStatus = e.grandFinale?.status;
    const gfStart  = e.grandFinale?.eventWindow?.start;

    // Start notifications — only when GF is active (not LOCKED)
    if (gfStart && gfStatus && gfStatus !== "LOCKED") {
      const gfDate = new Date(gfStart);
      if (!isNaN(gfDate.getTime())) {
        const timeToStartMs = gfDate.getTime() - now.getTime();
        
        // Reminder: ~11 minutes before
        const elevenMinsMs = 11 * 60 * 1000;
        if (timeToStartMs <= elevenMinsMs && timeToStartMs >= elevenMinsMs - WINDOW_MS) {
          await notifyGrandFinaleReminder(e);
        }
        
        // Start: ~1 minute before
        const oneMinMs = 1 * 60 * 1000;
        if (timeToStartMs <= oneMinMs && timeToStartMs >= oneMinMs - WINDOW_MS) {
          await notifyGrandFinaleStart(e);
        }
      }
    }

    // GF result declaration
    const isExternalLinkGrandFinale = e.grandFinale?.submission?.type === "EXTERNAL_LINK";
    if (
      (gfStatus === "CLOSED" || (isExternalLinkGrandFinale && gfStatus === "LIVE")) &&
      e.grandFinale?.resultDeclarationDate
    ) {
      const rdDate = new Date(e.grandFinale.resultDeclarationDate);
      const timeSinceResultMs = now.getTime() - rdDate.getTime();
      if (timeSinceResultMs >= 0 && timeSinceResultMs <= WINDOW_MS) {
        await autoDeclareFinalResult(e);
      }
    }
  }
};

// Backward-compat aliases (server.js imports these — will update server.js next)
export const runLiveCompetitionNotificationTick = runLiveCompetitionCronTick;
export const runLiveCompetitionResultTick       = runLiveCompetitionCronTick;

export default {
  runLiveCompetitionCronTick,
  runLiveCompetitionNotificationTick,
  runLiveCompetitionResultTick,
};
