// utils/sendEmail.js
import nodemailer from 'nodemailer';
import dotenv from "dotenv";
import { ApiError } from './ApiError.js';
import emailTemplateService from '../services/emailTemplate.service.js';
import { getDefaultTemplateByCategorySlug } from "./emailTemplateCategories.js";

dotenv.config();

/**
 * Resolve email subject and html from admin template if exists, else return null.
 * Caller uses default when null.
 */
const resolveTemplate = async (category, slug, variables) => {
  try {
    const template = await emailTemplateService.getTemplateByCategorySlug(category, slug);
    if (!template) return null;
    const subject = emailTemplateService.replaceTemplateVariables(template.subject, variables);
    const html = emailTemplateService.replaceTemplateVariables(template.content, variables);
    return { subject, html };
  } catch {
    return null;
  }
};

const resolveFallbackTemplate = ({
  category,
  slug,
  variables = {},
  defaultSubject,
  defaultHtml,
}) => {
  const defaultTemplate = getDefaultTemplateByCategorySlug(category, slug);
  const fallbackSubjectTemplate = defaultTemplate?.subject || defaultSubject || "";
  const fallbackHtmlTemplate = defaultTemplate?.html || defaultHtml || "";

  return {
    subject: emailTemplateService.replaceTemplateVariables(fallbackSubjectTemplate, variables),
    html: emailTemplateService.replaceTemplateVariables(fallbackHtmlTemplate, variables),
  };
};

// Validate required environment variables
const requiredEnvVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_EMAIL', 'SMTP_PASSWORD'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`⚠️  Missing required SMTP environment variables: ${missingVars.join(', ')}`);
  console.error('Please set these variables in your .env file');
}

// Create transporter with proper configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465', // Convert to boolean
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
  // Add timeout and connection options for better error handling
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP configuration error:', error.message);
    console.error('Please check your SMTP settings in .env file');
  } else {
    console.log('✅ SMTP server is ready to send emails');
  }
});

export const sendOTPEmail = async (email, otp, name) => {
  try {
    if (!email) {
      throw new ApiError(400, 'Email address is required');
    }
    if (missingVars.length > 0) {
      throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(', ')}`);
    }

    const info = await sendEmailWithTemplate({
      to: email,
      category: "login_otp",
      slug: "password_reset",
      variables: { name: name || "Student", otp },
      defaultSubject: "Your Password Change OTP",
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Hello ${name || "Student"},</h2>
          <p style="color: #666;">Use this OTP to change your password:</p>
          <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; border-radius: 5px;">
            <h1 style="letter-spacing: 8px; color: #333; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #666;">This OTP is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
        </div>
      `,
      from: `"TestLard Security" <${process.env.SMTP_CONNECT_EMAIL || process.env.SMTP_EMAIL}>`,
    });
    console.log(`✅ Email sent successfully to ${email}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    // Re-throw as ApiError for proper error handling
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, `Failed to send email: ${error.message}`);
  }
};

/**
 * Send email using template resolution. If admin has created a template for (category, slug), use it; else use defaultSubject and defaultHtml.
 * Use this when adding new email types (welcome, course enrollment, support ticket, etc.)
 */
export const sendEmailWithTemplate = async ({
  to: email,
  category,
  slug,
  variables = {},
  defaultSubject,
  defaultHtml,
  from = `"TestLard" <${process.env.SMTP_CONNECT_EMAIL || process.env.SMTP_EMAIL}>`,
  attachments = [],
}) => {
  if (!email) throw new ApiError(400, 'Email address is required');
  if (missingVars.length > 0) {
    throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(', ')}`);
  }
  const resolved = await resolveTemplate(category, slug, variables);
  const fallback = resolveFallbackTemplate({
    category,
    slug,
    variables,
    defaultSubject,
    defaultHtml,
  });
  const subject = resolved?.subject ?? fallback.subject;
  const html = resolved?.html ?? fallback.html;
  if (!subject || !html) {
    throw new ApiError(500, `No email template content found for ${category}/${slug}`);
  }
  const mailOptions = { from, to: email, subject, html };
  if (attachments && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }
  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ Email sent to ${email}. Message ID: ${info.messageId}`);
  return info;
};

/**
 * Send contact us form details to admin email (no JWT required).
 * @param {Object} payload - { name, phone, email, message }
 */
export const sendContactUsEmail = async ({ name, phone, email, message }) => {
  try {
    if (!email || !name || !message) {
      throw new ApiError(400, 'Name, email and message are required');
    }
    if (missingVars.length > 0) {
      throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(', ')}`);
    }

    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_EMAIL;
    if (!adminEmail) {
      throw new ApiError(500, 'Admin email not configured (set ADMIN_EMAIL or SMTP_EMAIL)');
    }

    const mailOptions = {
      from: `"TestLard Support" <${process.env.SMTP_SUPPORT_EMAIL || process.env.SMTP_EMAIL}>`,
      to: adminEmail,
      replyTo: email,
      subject: `Contact Us: ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">New Contact Form Submission</h2>
          <table style="width: 100%; border-collapse: collapse; color: #666;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Name</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${name}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Email</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Phone</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${phone || '—'}</td></tr>
            <tr><td style="padding: 8px 0; vertical-align: top;"><strong>Message</strong></td><td style="padding: 8px 0;">${message.replace(/\n/g, '<br>')}</td></tr>
          </table>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">Sent from TestLard Contact Us form.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Contact form email sent to admin. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('❌ Error sending contact email:', error.message);
    throw new ApiError(500, `Failed to send contact email: ${error.message}`);
  }
};

/**
 * Send interview schedule details to teacher (Teacher Connect Apply Job).
 * @param {Object} payload - { toEmail, teacherName, jobTitle, interviewDate, interviewTime, interviewProvider, providerLink }
 */
export const sendInterviewScheduledEmail = async ({
  toEmail,
  teacherName,
  jobTitle,
  interviewDate,
  interviewTime,
  interviewProvider,
  providerLink,
}) => {
  try {
    if (!toEmail || !jobTitle) {
      throw new ApiError(400, "Recipient email and job title are required");
    }
    if (missingVars.length > 0) {
      throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(", ")}`);
    }

    const dateStr = interviewDate ? new Date(interviewDate).toLocaleDateString("en-IN", { dateStyle: "long" }) : "—";
    const info = await sendEmailWithTemplate({
      to: toEmail,
      category: "teacher_application",
      slug: "interview_scheduled",
      variables: {
        name: teacherName || "Candidate",
        jobTitle,
        interviewDate: dateStr,
        interviewTime: interviewTime || "—",
        providerLink: providerLink || "",
        interviewProvider: interviewProvider || "—",
      },
      defaultSubject: `Interview Scheduled - ${jobTitle}`,
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Hello ${teacherName || "Candidate"},</h2>
          <p style="color: #666;">Your interview has been scheduled for the position: <strong>${jobTitle}</strong>.</p>
          <table style="width: 100%; border-collapse: collapse; color: #666;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Date</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${dateStr}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Time</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${interviewTime || "—"}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Platform</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${interviewProvider || "—"}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Join Link</strong></td><td style="padding: 8px 0;">${providerLink ? `<a href="${providerLink}">${providerLink}</a>` : "—"}</td></tr>
          </table>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">TestLard Teacher Connect</p>
        </div>
      `,
      from: `"TestLard Teacher Connect" <${process.env.SMTP_CONNECT_EMAIL || process.env.SMTP_EMAIL}>`,
    });
    console.log(`✅ Interview scheduled email sent to ${toEmail}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending interview email:", error.message);
    throw new ApiError(500, `Failed to send interview email: ${error.message}`);
  }
};

/**
 * Send approval confirmation only (no credentials) – e.g. after Apply Job approval.
 * @param {Object} payload - { toEmail, teacherName, jobTitle? }
 */
export const sendTeacherApprovalConfirmationEmail = async ({
  toEmail,
  teacherName,
  jobTitle,
}) => {
  try {
    if (!toEmail) {
      throw new ApiError(400, "Recipient email is required");
    }
    if (missingVars.length > 0) {
      throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(", ")}`);
    }

    const info = await sendEmailWithTemplate({
      to: toEmail,
      category: "teacher_application",
      slug: "approval_confirmation",
      variables: {
        name: teacherName || "Candidate",
        jobTitle: jobTitle || "Teacher position",
      },
      defaultSubject: "Congratulations - You have been selected as a Teacher",
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Hello ${teacherName || "Candidate"},</h2>
          <p style="color: #666;">Congratulations! You have been selected for ${jobTitle ? `<strong>${jobTitle}</strong>` : "the teacher position"}.</p>
          <p style="color: #666;">You will receive your login credentials separately. Please check your email or contact the admin if you have any questions.</p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">TestLard Teacher Connect</p>
        </div>
      `,
      from: `"TestLard Teacher Connect" <${process.env.SMTP_EMAIL}>`,
    });
    console.log(`✅ Teacher approval confirmation email sent to ${toEmail}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending approval confirmation email:", error.message);
    throw new ApiError(500, `Failed to send approval confirmation email: ${error.message}`);
  }
};

/**
 * Send login credentials to teacher (admin-triggered only).
 * @param {Object} payload - { toEmail, teacherName, email, password }
 */
export const sendTeacherApprovalWithCredentialsEmail = async ({
  toEmail,
  teacherName,
  email,
  password,
  attachments = [],
}) => {
  try {
    if (!toEmail || !email || !password) {
      throw new ApiError(400, "Recipient email, login email and password are required");
    }
    if (missingVars.length > 0) {
      throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(", ")}`);
    }

    const loginLink = `${process.env.FRONTEND_URL || 'https://app.iscorre.com'}/teacher/login`;

    const info = await sendEmailWithTemplate({
      to: toEmail,
      category: "teacher_application",
      slug: "approval",
      variables: {
        name: teacherName || "Teacher",
        email,
        password,
        loginLink,
      },
      defaultSubject: "Congratulations - You have been selected as a Teacher",
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Hello ${teacherName || "Teacher"},</h2>
          <p style="color: #666;">Congratulations! You have been selected. Please use the following credentials to log in to the teacher portal.</p>
          <table style="width: 100%; border-collapse: collapse; color: #666;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Email</strong></td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td></tr>
            <tr><td style="padding: 8px 0;"><strong>Password</strong></td><td style="padding: 8px 0;"><code style="background: #f4f4f4; padding: 4px 8px;">${password}</code></td></tr>
          </table>
          <p style="color: #666; margin-top: 20px;">
            <a href="${loginLink}" style="display: inline-block; background-color: #4F46E5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Login to Teacher Portal</a>
          </p>
          <p style="color: #666; margin-top: 15px;">Please change your password after first login.</p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">TestLard Teacher Connect</p>
        </div>
      `,
      from: `"TestLard Teacher Connect" <${process.env.SMTP_CONNECT_EMAIL || process.env.SMTP_EMAIL}>`,
      attachments,
    });
    console.log(`✅ Teacher approval email sent to ${toEmail}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending approval email:", error.message);
    throw new ApiError(500, `Failed to send approval email: ${error.message}`);
  }
};

/**
 * Send rejection email to teacher (Teacher Connect Apply Job).
 * @param {Object} payload - { toEmail, teacherName, jobTitle }
 */
export const sendTeacherRejectionEmail = async ({ toEmail, teacherName, jobTitle }) => {
  try {
    if (!toEmail) {
      throw new ApiError(400, "Recipient email is required");
    }
    if (missingVars.length > 0) {
      throw new ApiError(500, `SMTP configuration incomplete. Missing: ${missingVars.join(", ")}`);
    }

    const info = await sendEmailWithTemplate({
      to: toEmail,
      category: "teacher_application",
      slug: "rejection",
      variables: {
        name: teacherName || "Candidate",
        jobTitle: jobTitle || "Teacher Position",
      },
      defaultSubject: `Update on your application - ${jobTitle || "Teacher Position"}`,
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Hello ${teacherName || "Candidate"},</h2>
          <p style="color: #666;">Thank you for your interest. After careful consideration, we have decided not to move forward with your application for ${jobTitle ? `<strong>${jobTitle}</strong>` : "this position"}.</p>
          <p style="color: #666;">We encourage you to apply for other openings in the future.</p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">TestLard Teacher Connect</p>
        </div>
      `,
      from: `"TestLard Teacher Connect" <${process.env.SMTP_CONNECT_EMAIL || process.env.SMTP_EMAIL}>`,
    });
    console.log(`✅ Teacher rejection email sent to ${toEmail}. Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending rejection email:", error.message);
    throw new ApiError(500, `Failed to send rejection email: ${error.message}`);
  }
};

/**
 * Send Welcome Email to student upon signup
 */
export const sendWelcomeEmail = async (email, name) => {
  try {
    const info = await sendEmailWithTemplate({
      to: email,
      category: "registration",
      slug: "welcome_email",
      variables: { name: name || "Student" },
    });
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending welcome email:", error.message);
  }
};

/**
 * Send Course Enrollment Email
 */
export const sendCourseEnrollmentEmail = async (email, name, courseTitle, amount, date) => {
  try {
    const info = await sendEmailWithTemplate({
      to: email,
      category: "enrolment",
      slug: "course_enrollment",
      from: `"TestLard" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        courseTitle: courseTitle || "Course",
        amount: amount != null ? amount.toString() : "0",
        date: date ? new Date(date).toLocaleDateString() : new Date().toLocaleDateString()
      },
    });
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending course enrollment email:", error.message);
  }
};

/**
 * Send Test Bundle Purchase Email
 */
export const sendTestBundlePurchaseEmail = async (email, name, bundleName, amount, date) => {
  try {
    const info = await sendEmailWithTemplate({
      to: email,
      category: "enrolment",
      slug: "test_bundle_purchase",
      from: `"TestLard" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        bundleName: bundleName || "Bundle",
        amount: amount != null ? amount.toString() : "0",
        date: date ? new Date(date).toLocaleDateString() : new Date().toLocaleDateString()
      },
    });
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending test bundle purchase email:", error.message);
  }
};

/**
 * Send Event Registration Email
 */
export const sendEventRegistrationEmail = async (eventType, email, name, eventTitle, amount, date) => {
  let slug = "workshop_registration";
  if (eventType === "tournament") slug = "tournament_registration";

  try {
    const info = await sendEmailWithTemplate({
      to: email,
      category: "enrolment",
      slug,
      from: `"TestLard" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        eventTitle: eventTitle || "Event",
        amount: amount != null ? amount.toString() : "0",
        date: date ? new Date(date).toLocaleDateString() : new Date().toLocaleDateString()
      },
    });
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error(`❌ Error sending ${slug} email:`, error.message);
  }
};

/**
 * Send Support Ticket Received Email
 */
export const sendTicketReceivedEmail = async (email, name, ticketNumber, subject) => {
  try {
    const info = await sendEmailWithTemplate({
      to: email,
      category: "support_ticket",
      slug: "ticket_received",
      variables: {
        name: name || "Student",
        ticketNumber: ticketNumber || "—",
        subject: subject || "Support Ticket"
      },
    });
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending ticket received email:", error.message);
  }
};

/**
 * Send Support Ticket Reply Email
 */
export const sendTicketReplyEmail = async (email, name, ticketNumber, message) => {
  try {
    const info = await sendEmailWithTemplate({
      to: email,
      category: "support_ticket",
      slug: "ticket_reply",
      variables: {
        name: name || "Student",
        ticketNumber: ticketNumber || "—",
        message: message || "You have a new reply to your ticket."
      },
    });
    return info;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error("❌ Error sending ticket reply email:", error.message);
  }
};

/**
 * Send 10-minute start reminder email for a Tournament or Olympiad.
 * @param {Object} payload - { email, name, eventName, eventType, startTime }
 */
export const sendEventStartReminderEmail = async ({ email, name, eventName, eventType, startTime }) => {
  if (!email) return;
  try {
    let eventLabel = "Event";
    if (eventType) {
      if (eventType === "live_competition") {
        eventLabel = "Live Competition";
      } else {
        eventLabel = eventType.charAt(0).toUpperCase() + eventType.slice(1);
      }
    }
    const startStr = startTime
      ? new Date(startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
      : "—";

    await sendEmailWithTemplate({
      to: email,
      category: "event_notifications",
      slug: `${eventType}_start_reminder`,
      from: `"TestLard Events" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        eventName: eventName || eventLabel,
        eventLabel,
        startTime: startStr,
      },
      defaultSubject: `⏰ ${eventName} starts in 10 minutes!`,
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 24px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">⏰ 10 Minutes to Go!</h1>
          </div>
          <div style="padding: 28px 24px;">
            <p style="color: #333; font-size: 16px; margin-top: 0;">Hi <strong>${name || "Student"}</strong>,</p>
            <p style="color: #555; font-size: 15px;">Your ${eventLabel} is about to start! Here are the details:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #888; width: 40%;"><strong>Event</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-weight: bold;">${eventName}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #888;"><strong>Starts At</strong></td>
                <td style="padding: 10px 0; color: #333;">${startStr}</td>
              </tr>
            </table>
            <div style="background: #f9f9f9; border-left: 4px solid #667eea; padding: 16px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 0; color: #555; font-style: italic;">
                "Stay calm, trust your preparation, and give it your best shot. Best of luck! 🌟"
              </p>
            </div>
            <p style="color: #888; font-size: 13px; margin-top: 24px;">Open the app now and get ready. The exam window opens soon!</p>
          </div>
          <div style="background: #f5f5f5; padding: 16px 24px; text-align: center;">
            <p style="color: #aaa; font-size: 12px; margin: 0;">TestLard — Empowering Every Learner</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error(`❌ Error sending event start reminder email to ${email}:`, err.message);
  }
};

/**
 * Send exact start time email for a Tournament, Live Competition, or Olympiad.
 * @param {Object} payload - { email, name, eventName, eventType, startTime }
 */
export const sendEventStartEmail = async ({ email, name, eventName, eventType, startTime }) => {
  if (!email) return;
  try {
    let eventLabel = "Event";
    if (eventType) {
      if (eventType === "live_competition") {
        eventLabel = "Live Competition";
      } else {
        eventLabel = eventType.charAt(0).toUpperCase() + eventType.slice(1);
      }
    }
    const startStr = startTime
      ? new Date(startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
      : "—";

    await sendEmailWithTemplate({
      to: email,
      category: "event_notifications",
      slug: `${eventType}_start`,
      from: `"TestLard Events" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        eventName: eventName || eventLabel,
        eventLabel,
        startTime: startStr,
      },
      defaultSubject: `🚀 ${eventName} is LIVE NOW!`,
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px 24px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">🚀 Event is Live!</h1>
          </div>
          <div style="padding: 28px 24px;">
            <p style="color: #333; font-size: 16px; margin-top: 0;">Hi <strong>${name || "Student"}</strong>,</p>
            <p style="color: #555; font-size: 15px;">Your ${eventLabel} has officially started! Open the app to begin:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #888; width: 40%;"><strong>Event</strong></td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; color: #333; font-weight: bold;">${eventName}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #888;"><strong>Started At</strong></td>
                <td style="padding: 10px 0; color: #333;">${startStr}</td>
              </tr>
            </table>
            <div style="background: #f9f9f9; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 0; color: #555; font-style: italic;">
                "This is your moment. Give it your best shot and shine! Good luck! 🌟"
              </p>
            </div>
            <p style="color: #888; font-size: 13px; margin-top: 24px;">Open the app now to enter the exam window.</p>
          </div>
          <div style="background: #f5f5f5; padding: 16px 24px; text-align: center;">
            <p style="color: #aaa; font-size: 12px; margin: 0;">TestLard — Empowering Every Learner</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error(`❌ Error sending event start email to ${email}:`, err.message);
  }
};

/**
/**
 * Send result declared email for a Tournament or Olympiad.
 * Simple message: results are now live, go check the app/website.
 * @param {Object} payload - { email, name, eventName, eventType, score, maxScore, rank }
 */
export const sendEventResultEmail = async ({ email, name, eventName, eventType, score, maxScore, rank }) => {
  if (!email) return;
  try {
    let eventLabel = "Event";
    if (eventType) {
      if (eventType === "live_competition") {
        eventLabel = "Live Competition";
      } else {
        eventLabel = eventType.charAt(0).toUpperCase() + eventType.slice(1);
      }
    }

    await sendEmailWithTemplate({
      to: email,
      category: "event_notifications",
      slug: `${eventType}_result_declared`,
      from: `"TestLard Events" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        eventName: eventName || eventLabel,
        eventLabel,
        score: score !== undefined ? String(score) : "",
        maxScore: maxScore !== undefined ? String(maxScore) : "",
        rank: rank !== undefined ? String(rank) : "",
      },
      defaultSubject: `📊 Your ${eventLabel} Results Are Live — ${eventName}`,
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 30px 24px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">📊 Results Are Live!</h1>
          </div>
          <div style="padding: 28px 24px;">
            <p style="color: #333; font-size: 16px; margin-top: 0;">Hi <strong>${name || "Student"}</strong>,</p>
            <p style="color: #555; font-size: 15px;">
              The results for your <strong>${eventLabel}</strong> <strong>"${eventName}"</strong> are now officially live!
            </p>
            ${score !== undefined && rank !== undefined ? `
            <div style="background: #ffffff; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
              <h3 style="margin-top: 0; color: #333;">Your Performance</h3>
              <div style="display: flex; justify-content: space-around; flex-wrap: wrap;">
                <div style="margin: 10px;">
                  <span style="display: block; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Rank</span>
                  <span style="display: block; font-size: 28px; font-weight: bold; color: #f5576c;">#${rank}</span>
                </div>
                <div style="margin: 10px;">
                  <span style="display: block; font-size: 13px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Score</span>
                  <span style="display: block; font-size: 28px; font-weight: bold; color: #667eea;">${score}${maxScore !== undefined && maxScore !== null ? `/${maxScore}` : ''}</span>
                </div>
              </div>
            </div>
            ` : ''}
            <p style="color: #555; font-size: 15px;">
              You can now visit the app or website to view your full result and the leaderboard.
            </p>
            <div style="background: #f9f9f9; border-left: 4px solid #f5576c; padding: 16px; border-radius: 4px; margin: 20px 0;">
              <p style="margin: 0; color: #555; font-style: italic;">
                "Regardless of the outcome, every competition makes you stronger. Keep going! 🌟"
              </p>
            </div>
            <p style="color: #888; font-size: 13px; margin-top: 24px;">Open the app or visit our website to check your results now.</p>
          </div>
          <div style="background: #f5f5f5; padding: 16px 24px; text-align: center;">
            <p style="color: #aaa; font-size: 12px; margin: 0;">TestLard — Empowering Every Learner</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error(`❌ Error sending event result email to ${email}:`, err.message);
  }
};
/**
 * Send event update email when an admin edits a Tournament, Live Competition, or Olympiad.
 * @param {Object} payload - { email, name, eventName, eventType, changedFieldsList }
 */
export const sendEventUpdateEmail = async ({ email, name, eventName, eventType, changedFieldsList }) => {
  if (!email) return;
  try {
    let eventLabel = "Event";
    if (eventType) {
      if (eventType === "live_competition") {
        eventLabel = "Live Competition";
      } else {
        eventLabel = eventType.charAt(0).toUpperCase() + eventType.slice(1);
      }
    }

    let changesHtml = "";
    if (changedFieldsList && changedFieldsList.length > 0) {
      changesHtml = `<p style="color: #555; font-size: 15px;"><strong>Recent Updates:</strong> ${changedFieldsList.join(", ")}</p>`;
    }

    await sendEmailWithTemplate({
      to: email,
      category: "event_notifications",
      slug: `${eventType}_update`,
      from: `"TestLard Events" <${process.env.SMTP_NOREPLY_EMAIL || process.env.SMTP_EMAIL}>`,
      variables: {
        name: name || "Student",
        eventName: eventName || eventLabel,
        eventLabel,
        changes: changedFieldsList ? changedFieldsList.join(", ") : ""
      },
      defaultSubject: `📢 Important Update: ${eventName} has been modified`,
      defaultHtml: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #f6d365 0%, #fda085 100%); padding: 30px 24px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">📢 Event Updated</h1>
          </div>
          <div style="padding: 28px 24px;">
            <p style="color: #333; font-size: 16px; margin-top: 0;">Hi <strong>${name || "Student"}</strong>,</p>
            <p style="color: #555; font-size: 15px;">
              The admins have recently updated the details for your registered ${eventLabel}, <strong>"${eventName}"</strong>.
            </p>
            ${changesHtml}
            <p style="color: #555; font-size: 15px;">
              Please review these changes in the app or website to ensure you're fully prepared.
            </p>
            <p style="color: #888; font-size: 13px; margin-top: 24px;">Thank you for participating!</p>
          </div>
          <div style="background: #f5f5f5; padding: 16px 24px; text-align: center;">
            <p style="color: #aaa; font-size: 12px; margin: 0;">TestLard — Empowering Every Learner</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error(`❌ Error sending event update email to ${email}:`, err.message);
  }
};


