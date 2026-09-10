/**
 * Predefined email template categories and slugs.
 * Used for admin dropdown and template resolution.
 * When sending email: if admin-created template exists for (category, slug), use it; else use backend default.
 */
export const EMAIL_TEMPLATE_CATEGORIES = [
  {
    key: "registration",
    label: "Registration",
    description: "User onboarding and account verification templates.",
    audience: "student",
    slugs: [
      {
        key: "welcome_email",
        label: "Welcome Email",
        description: "Sent after successful signup.",
        requiredVariables: ["name"],
        defaultSubject: "Welcome to TestLard, {{name}}!",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Hello {{name}},</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">Welcome to the learning platform! We are absolutely thrilled to have you with us.</p>
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">You can now start exploring courses, taking tests, and utilizing our learning tools directly from your student dashboard.</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="#" style="display:inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px;">Go to Dashboard</a>
              </div>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">Happy Learning,<br/><strong>The TestLard Team</strong></p>
            </div>
          </div>
        `,
      },
      {
        key: "email_verification",
        label: "Email Verification",
        description: "Sent when user must verify email address.",
        requiredVariables: ["name", "link"],
        defaultSubject: "Verify your TestLard email address",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Hello {{name}},</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">Please verify your email address to secure your account and continue using all features of the platform.</p>
              <div style="text-align: center; margin: 32px 0;">
                <a href="{{link}}" style="display:inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 600; border-radius: 6px;">Verify Email Address</a>
              </div>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">If you did not create this account, please ignore this email.</p>
            </div>
          </div>
        `,
      },
    ],
    variables: ["{{name}}", "{{link}}", "{{email}}"],
  },
  {
    key: "login_otp",
    label: "Login / OTP",
    description: "Authentication and password reset templates.",
    audience: "all_users",
    slugs: [
      {
        key: "password_reset",
        label: "Password Reset",
        description: "OTP used in forgot password flow.",
        requiredVariables: ["name", "otp"],
        defaultSubject: "Your Password Change OTP",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Hello {{name}},</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">We received a request to change the password for your account. Please use the following One-Time Password (OTP) to securely reset your password:</p>
              <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 20px; text-align: center; margin: 24px 0; border-radius: 8px;">
                <h1 style="letter-spacing: 12px; color: #0f172a; font-size: 36px; margin: 0; padding-left: 12px;">{{otp}}</h1>
              </div>
              <p style="color: #ef4444; font-size: 14px; text-align: center; font-weight: 500;">This OTP is valid for exactly 10 minutes.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">If you did not request this, please safely ignore this email.</p>
            </div>
          </div>
        `,
      },
      {
        key: "login_otp",
        label: "Login OTP",
        description: "OTP for login verification / MFA style login.",
        requiredVariables: ["name", "otp"],
        defaultSubject: "Your TestLard login OTP",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Hello {{name}},</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">Please enter the following OTP to securely complete your login process:</p>
              <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; padding: 20px; text-align: center; margin: 24px 0; border-radius: 8px;">
                <h1 style="letter-spacing: 12px; color: #0f172a; font-size: 36px; margin: 0; padding-left: 12px;">{{otp}}</h1>
              </div>
              <p style="color: #475569; font-size: 14px; text-align: center;">For your security, do not share this code with anyone.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">This is an automated security message.</p>
            </div>
          </div>
        `,
      },
    ],
    variables: ["{{name}}", "{{otp}}", "{{link}}"],
  },
  {
    key: "enrolment",
    label: "Enrolment",
    description: "Course, test, workshop and competition enrollment confirmations.",
    audience: "student",
    slugs: [
      {
        key: "course_enrollment",
        label: "Course Enrollment Confirmation",
        description: "Sent when a learner enrolls in a course.",
        requiredVariables: ["name", "course", "amount", "date"],
        defaultSubject: "Enrollment confirmed: {{course}}",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Purchase Successful!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, your enrollment into the course has been successfully processed.</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 12px 16px; font-size: 14px; color: #475569; font-weight: 600;">Course Name</th>
                  </tr>
                  <tr>
                    <td style="padding: 16px; font-size: 15px; color: #0f172a; border-bottom: 1px solid #e2e8f0;"><strong>{{course}}</strong></td>
                  </tr>
                </table>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569; border-right: 1px solid #e2e8f0;">Date: <strong>{{date}}</strong></td>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569;">Amount Paid: <strong style="color: #2563eb;">{{amount}}</strong></td>
                  </tr>
                </table>
              </div>
              <p style="color: #475569; font-size: 15px;">You can access your course materials from your dashboard.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">Happy Learning,<br/><strong>The TestLard Team</strong></p>
            </div>
          </div>
        `,
      },
      {
        key: "test_bundle_purchase",
        label: "Test Bundle Purchase Confirmation",
        description: "Sent after test bundle purchase.",
        requiredVariables: ["name", "testBundle", "amount", "date"],
        defaultSubject: "Test bundle purchase confirmed",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Test Bundle Unlocked!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, your test bundle purchase has been successfully processed.</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 12px 16px; font-size: 14px; color: #475569; font-weight: 600;">Test Bundle</th>
                  </tr>
                  <tr>
                    <td style="padding: 16px; font-size: 15px; color: #0f172a; border-bottom: 1px solid #e2e8f0;"><strong>{{testBundle}}</strong></td>
                  </tr>
                </table>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569; border-right: 1px solid #e2e8f0;">Date: <strong>{{date}}</strong></td>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569;">Amount Paid: <strong style="color: #2563eb;">{{amount}}</strong></td>
                  </tr>
                </table>
              </div>
              <p style="color: #475569; font-size: 15px;">All the best for your preparations!</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;"><strong>The TestLard Team</strong></p>
            </div>
          </div>
        `,
      },

      {
        key: "tournament_registration",
        label: "Tournament Registration Confirmation",
        description: "Sent after tournament registration.",
        requiredVariables: ["name", "event", "amount", "date"],
        defaultSubject: "Tournament registration confirmed",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">You're in the Tournament!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, your registration for the tournament is confirmed.</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 12px 16px; font-size: 14px; color: #475569; font-weight: 600;">Tournament</th>
                  </tr>
                  <tr>
                    <td style="padding: 16px; font-size: 15px; color: #0f172a; border-bottom: 1px solid #e2e8f0;"><strong>{{event}}</strong></td>
                  </tr>
                </table>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569; border-right: 1px solid #e2e8f0;">Date: <strong>{{date}}</strong></td>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569;">Transaction: <strong style="color: #2563eb;">{{amount}}</strong></td>
                  </tr>
                </table>
              </div>
              <p style="color: #475569; font-size: 15px;">See you at the event!</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;"><strong>The TestLard Team</strong></p>
            </div>
          </div>
        `,
      },
      {
        key: "workshop_registration",
        label: "Workshop Registration Confirmation",
        description: "Sent after workshop registration.",
        requiredVariables: ["name", "event", "amount", "date"],
        defaultSubject: "Workshop registration confirmed",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Workshop Registration Confirmed!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, you are officially registered for our learning workshop.</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 12px 16px; font-size: 14px; color: #475569; font-weight: 600;">Workshop Event</th>
                  </tr>
                  <tr>
                    <td style="padding: 16px; font-size: 15px; color: #0f172a; border-bottom: 1px solid #e2e8f0;"><strong>{{event}}</strong></td>
                  </tr>
                </table>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569; border-right: 1px solid #e2e8f0;">Date: <strong>{{date}}</strong></td>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569;">Transaction: <strong style="color: #2563eb;">{{amount}}</strong></td>
                  </tr>
                </table>
              </div>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;"><strong>The TestLard Team</strong></p>
            </div>
          </div>
        `,
      },
    ],
    variables: ["{{name}}", "{{course}}", "{{testBundle}}", "{{event}}", "{{amount}}", "{{date}}"],
  },
  {
    key: "support_ticket",
    label: "Support Ticket",
    description: "Support ticket acknowledgment and updates.",
    audience: "all_users",
    slugs: [
      {
        key: "ticket_received",
        label: "Ticket Received",
        description: "Sent when support ticket is created.",
        requiredVariables: ["name", "ticketNumber", "subject"],
        defaultSubject: "Ticket received: {{ticketNumber}}",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">We've received your request!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, our support team has received your ticket and will be in touch shortly.</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                    <th style="padding: 12px 16px; font-size: 14px; color: #475569; font-weight: 600;">Subject</th>
                  </tr>
                  <tr>
                    <td style="padding: 16px; font-size: 15px; color: #0f172a; border-bottom: 1px solid #e2e8f0;"><strong>{{subject}}</strong></td>
                  </tr>
                </table>
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569;">Ticket Reference ID: <strong style="color: #2563eb; background-color: #dbeafe; padding: 2px 6px; border-radius: 4px;">{{ticketNumber}}</strong></td>
                  </tr>
                </table>
              </div>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">TestLard Customer Support System</p>
            </div>
          </div>
        `,
      },
      {
        key: "ticket_reply",
        label: "Ticket Update / Reply",
        description: "Sent when support team replies to ticket.",
        requiredVariables: ["name", "ticketNumber", "message"],
        defaultSubject: "Update on ticket {{ticketNumber}}",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <p style="color: #475569; font-size: 14px; float: right; margin: 0; background-color: #f1f5f9; padding: 4px 8px; border-radius: 4px;">#{{ticketNumber}}</p>
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Ticket Update</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, an admin has replied to your support ticket:</p>
              
              <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 16px; margin: 24px 0; border-radius: 0 4px 4px 0;">
                <p style="color: #0f172a; font-size: 15px; margin: 0; font-style: italic;">{{message}}</p>
              </div>
              <p style="color: #475569; font-size: 14px;">Please login to your dashboard to continue the conversation or mark it as resolved.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">TestLard Customer Support System</p>
            </div>
          </div>
        `,
      },
    ],
    variables: ["{{name}}", "{{ticketId}}", "{{ticketNumber}}", "{{subject}}", "{{message}}", "{{link}}"],
  },
  {
    key: "teacher_application",
    label: "Teacher Application",
    description: "Teacher job application lifecycle notifications.",
    audience: "teacher",
    slugs: [
      {
        key: "interview_scheduled",
        label: "Interview Scheduled",
        description: "Sent when interview date/time is assigned.",
        requiredVariables: ["name", "jobTitle", "interviewDate", "interviewTime", "providerLink"],
        defaultSubject: "Interview Scheduled - {{jobTitle}}",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Interview Scheduled</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, your interview has been successfully scheduled for the <strong>{{jobTitle}}</strong> position.</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">Date: <strong style="color:#0f172a;">{{interviewDate}}</strong></td>
                    <td style="padding: 12px 16px; font-size: 14px; color: #475569; border-bottom: 1px solid #e2e8f0;">Time: <strong style="color:#0f172a;">{{interviewTime}}</strong></td>
                  </tr>
                  <tr style="background-color: #f8fafc;">
                    <td colspan="2" style="padding: 16px; font-size: 15px; text-align: center;">Join Link: <br/><a href="{{providerLink}}" style="color: #2563eb; text-decoration: none; font-weight: 500; word-break: break-all;">{{providerLink}}</a></td>
                  </tr>
                </table>
              </div>
              <p style="color: #475569; font-size: 15px;">We look forward to speaking with you!</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">TestLard Teacher Connect</p>
            </div>
          </div>
        `,
      },
      {
        key: "approval",
        label: "Approval / Credentials",
        description: "Sent when teacher profile is approved and credentials are shared.",
        requiredVariables: ["name", "email", "password"],
        defaultSubject: "Congratulations - You have been selected as a Teacher",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Welcome to the Team!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, congratulations! You have been officially selected to join us as a teacher. Below are your login credentials for the portal:</p>
              
              <div style="margin: 24px 0; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; text-align: left;">
                  <tr><td style="padding: 12px 16px; font-size: 14px; color: #475569; border-bottom: 1px solid #e2e8f0;">Login Email: <strong style="color: #0f172a;">{{email}}</strong></td></tr>
                  <tr><td style="padding: 12px 16px; font-size: 14px; color: #475569;">Temporary Password: <strong style="color: #0f172a; background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px; letter-spacing: 1px;">{{password}}</strong></td></tr>
                </table>
              </div>
              <p style="color: #475569; font-size: 14px; font-style: italic;">For security reasons, please ensure you change your password immediately upon your first login.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">TestLard Teacher Connect</p>
            </div>
          </div>
        `,
      },
      {
        key: "approval_confirmation",
        label: "Approval Confirmation",
        description: "Sent when teacher is approved but credentials are not included.",
        requiredVariables: ["name", "jobTitle"],
        defaultSubject: "Congratulations - You are selected as a Teacher",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #2563eb; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Congratulations!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}}, we are excited to inform you that you have been selected for the <strong>{{jobTitle}}</strong> position.</p>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">You will receive your portal login details and next steps in a separate communication soon.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">TestLard Teacher Connect</p>
            </div>
          </div>
        `,
      },
      {
        key: "rejection",
        label: "Rejection",
        description: "Sent when teacher application is not selected.",
        requiredVariables: ["name", "jobTitle"],
        defaultSubject: "Update on your application - {{jobTitle}}",
        defaultContent: `
          <div style="font-family: 'Inter', Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.02);">
            <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-bottom: 1px solid #e2e8f0;">
              <h1 style="color: #64748b; margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">TestLard</h1>
            </div>
            <div style="padding: 32px 24px;">
              <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0;">Application Update</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hello {{name}},</p>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">Thank you for your interest and for taking the time to apply for the <strong>{{jobTitle}}</strong> position.</p>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">While we were impressed with your background, we have decided not to move forward with your application at this time.</p>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">We encourage you to apply for future openings that match your skill set.</p>
            </div>
            <div style="background-color: #f1f5f9; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="color: #64748b; font-size: 13px; margin: 0;">TestLard Teacher Connect</p>
            </div>
          </div>
        `,
      },
    ],
    variables: ["{{name}}", "{{jobTitle}}", "{{interviewDate}}", "{{interviewTime}}", "{{providerLink}}", "{{email}}", "{{password}}"],
  },
  {
    key: "event_notifications",
    label: "Event Notifications",
    description: "Start reminders, event live alerts, and result declarations for live competitions, tournaments, and olympiads.",
    audience: "student",
    slugs: [
      {
        key: "live_competition_gf_start_reminder",
        label: "Live Competition — Grand Finale Reminder (11 min)",
        description: "Sent 11 minutes before the Grand Finale (Round 2) event window opens.",
        requiredVariables: ["name", "eventName", "startTime"],
        defaultSubject: "⏰ {{eventName}} Grand Finale starts in 11 minutes!",
        defaultContent: `<p>Hi {{name}},</p><p>The Grand Finale of <strong>{{eventName}}</strong> starts in 11 minutes at <strong>{{startTime}}</strong>. Get ready to give your best performance!</p>`,
      },
      {
        key: "live_competition_gf_start",
        label: "Live Competition — Grand Finale Started",
        description: "Sent when the Grand Finale (Round 2) event window opens.",
        requiredVariables: ["name", "eventName", "startTime"],
        defaultSubject: "🏆 {{eventName}} Grand Finale is now LIVE!",
        defaultContent: `<p>Hi {{name}},</p><p>The Grand Finale of <strong>{{eventName}}</strong> has started! Open the app now and submit your Grand Finale entry.</p>`,
      },
      {
        key: "live_competition_start_reminder",
        label: "Live Competition — Start Reminder (11 min)",
        description: "Sent 11 minutes before a live competition event window opens.",
        requiredVariables: ["name", "eventName", "startTime"],
        defaultSubject: "⏰ {{eventName}} starts in 11 minutes!",
        defaultContent: `<p>Hi {{name}},</p><p>Your Live Competition <strong>{{eventName}}</strong> starts in 11 minutes at <strong>{{startTime}}</strong>. Get ready!</p>`,
      },
      {
        key: "live_competition_start",
        label: "Live Competition — Event Started",
        description: "Sent when a live competition event window opens.",
        requiredVariables: ["name", "eventName", "startTime"],
        defaultSubject: "🎉 {{eventName}} is now LIVE!",
        defaultContent: `<p>Hi {{name}},</p><p><strong>{{eventName}}</strong> has officially started! Open the app now and submit your entry.</p>`,
      },
      {
        key: "live_competition_round1_qualified",
        label: "Live Competition — Round 1 Qualified",
        description: "Sent to students who qualified for Grand Finale after Round 1 results.",
        requiredVariables: ["name", "eventName", "totalQualifiers"],
        defaultSubject: "🎉 You Qualified for Round 2 — {{eventName}}",
        defaultContent: `<p>Hi {{name}},</p><p>Congratulations! You have qualified for the Grand Finale of <strong>{{eventName}}</strong>. Open the app to complete your Round 2 registration.</p>`,
      },
      {
        key: "live_competition_round1_not_qualified",
        label: "Live Competition — Round 1 Not Qualified",
        description: "Sent to students who did not qualify for Grand Finale after Round 1 results.",
        requiredVariables: ["name", "eventName"],
        defaultSubject: "📊 Round 1 Results — {{eventName}}",
        defaultContent: `<p>Hi {{name}},</p><p>Thank you for participating in <strong>{{eventName}}</strong>. Round 1 results are now live. Unfortunately, you did not qualify for the Grand Finale this time. Keep going!</p>`,
      },
      {
        key: "live_competition_round2_result",
        label: "Live Competition — Grand Finale Result",
        description: "Sent when Grand Finale results are declared. Includes student rank.",
        requiredVariables: ["name", "eventName", "rank"],
        defaultSubject: "🏆 Grand Finale Results — {{eventName}}",
        defaultContent: `<p>Hi {{name}},</p><p>The Grand Finale results for <strong>{{eventName}}</strong> are live! Your rank: <strong>{{rank}}</strong>. Open the app to view the full leaderboard.</p>`,
      },
      {
        key: "tournament_start_reminder",
        label: "Tournament — Start Reminder",
        description: "Sent before a tournament stage starts.",
        requiredVariables: ["name", "eventName", "startTime"],
        defaultSubject: "⏰ {{eventName}} starts soon!",
        defaultContent: `<p>Hi {{name}},</p><p><strong>{{eventName}}</strong> is about to start at <strong>{{startTime}}</strong>. Get ready!</p>`,
      },
      {
        key: "tournament_result_declared",
        label: "Tournament — Result Declared",
        description: "Sent when tournament stage or final results are declared.",
        requiredVariables: ["name", "eventName"],
        defaultSubject: "📊 Tournament Results — {{eventName}}",
        defaultContent: `<p>Hi {{name}},</p><p>Results for <strong>{{eventName}}</strong> are now live. Open the app to check your ranking.</p>`,
      },
      {
        key: "olympiad_start_reminder",
        label: "Olympiad — Start Reminder",
        description: "Sent before an olympiad starts.",
        requiredVariables: ["name", "eventName", "startTime"],
        defaultSubject: "⏰ {{eventName}} starts soon!",
        defaultContent: `<p>Hi {{name}},</p><p>Your Olympiad <strong>{{eventName}}</strong> starts at <strong>{{startTime}}</strong>. Get ready!</p>`,
      },
      {
        key: "olympiad_result_declared",
        label: "Olympiad — Result Declared",
        description: "Sent when olympiad results are declared.",
        requiredVariables: ["name", "eventName"],
        defaultSubject: "📊 Olympiad Results — {{eventName}}",
        defaultContent: `<p>Hi {{name}},</p><p>Results for the Olympiad <strong>{{eventName}}</strong> are now live. Open the app to see your rank and score.</p>`,
      },
    ],
    variables: ["{{name}}", "{{eventName}}", "{{eventLabel}}", "{{startTime}}", "{{rank}}", "{{score}}", "{{maxScore}}", "{{totalQualifiers}}"],
  },
];

export const getCategoryByKey = (key) =>
  EMAIL_TEMPLATE_CATEGORIES.find((c) => c.key === key);

export const getSlugByKey = (categoryKey, slugKey) => {
  const category = getCategoryByKey(categoryKey);
  if (!category) return null;
  return category.slugs.find((s) => s.key === slugKey) || null;
};

export const isValidCategorySlug = (categoryKey, slugKey) =>
  Boolean(getSlugByKey(categoryKey, slugKey));

export const getDefaultTemplateByCategorySlug = (categoryKey, slugKey) => {
  const slug = getSlugByKey(categoryKey, slugKey);
  if (!slug) return null;
  return {
    subject: slug.defaultSubject || "",
    html: slug.defaultContent || "",
    requiredVariables: slug.requiredVariables || [],
  };
};
