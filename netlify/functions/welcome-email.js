// welcome-email.js — Sends branded welcome email to new SEA Dashboard users
// Called after successful signup with { email, name, userId }

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

const __dirname = dirname(fileURLToPath(import.meta.url));

const getPdfBase64 = () => {
  try {
    const pdfPath = join(__dirname, 'sea-onboarding-guide.pdf');
    return readFileSync(pdfPath).toString('base64');
  } catch (e) {
    console.error('Could not read PDF attachment:', e.message);
    return null;
  }
};

const buildWelcomeEmail = (name) => {
  const firstName = name ? name.split(' ')[0] : 'there';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to S.E.A. Dashboard</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:36px 40px 28px;text-align:center;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.7);">Getting Results Inc.</p>
            <h1 style="margin:0;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">S.E.A. Dashboard</h1>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);">Slight Edge Accelerator</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px 8px;">
            <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:#111827;">Hey ${firstName} 👋</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#374151;">
              Welcome to the S.E.A. Dashboard — I'm glad you're here. This app is built around one idea: <strong>small, consistent actions compound into extraordinary results.</strong>
            </p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#374151;">
              Here's how to get set up and start building momentum right away:
            </p>
          </td>
        </tr>

        <!-- Steps -->
        <tr>
          <td style="padding:0 40px 8px;">

            <!-- Step 1 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#2563eb;text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#fff;">1</div>
                </td>
                <td style="padding-left:12px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Add to Your Home Screen 📲</p>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                    On iPhone: open the app in Safari → tap the <strong>Share</strong> button → tap <strong>"Add to Home Screen"</strong>. This is required for push notification reminders to work.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Step 2 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#2563eb;text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#fff;">2</div>
                </td>
                <td style="padding-left:12px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Enable Push Notifications 🔔</p>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                    Go to <strong>More → Settings → Push Notifications</strong> and tap Enable. You'll get an evening reminder at 7 PM, a Sunday planning reminder at 8 AM, and coach nudges when you've been inactive.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Step 3 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#2563eb;text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#fff;">3</div>
                </td>
                <td style="padding-left:12px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Set Up Your Anvil Project 🔨</p>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                    Your Anvil is your one most important deep-work project right now. Set it in the <strong>Anvil tab</strong> and log sessions daily — it's worth 25 points in your weekly score.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Step 4 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#2563eb;text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#fff;">4</div>
                </td>
                <td style="padding-left:12px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Track Your Habits Daily ✅</p>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                    Check off your habits on the <strong>Today tab</strong> each day. Habit completion is worth 30 points — the biggest single category in your score.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Step 5 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#2563eb;text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#fff;">5</div>
                </td>
                <td style="padding-left:12px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Do the Sunday Ritual 📋</p>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                    Every Sunday, complete your <strong>Weekly Ritual</strong> in the More tab — plan your week, set your focus, and document your wins. It takes 10 minutes and is worth 15 points.
                  </p>
                </td>
              </tr>
            </table>

            <!-- Step 6 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
              <tr>
                <td width="44" valign="top" style="padding-top:2px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#2563eb;text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#fff;">6</div>
                </td>
                <td style="padding-left:12px;">
                  <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">Share Your Score with Your Coach 📊</p>
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">
                    Go to the <strong>Score tab</strong> and tap "Share with Coach" to send your weekly breakdown. Your coach reviews it and can send you personalized feedback directly in the app.
                  </p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- Score breakdown callout -->
        <tr>
          <td style="padding:24px 40px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7ff;border-radius:12px;border-left:4px solid #2563eb;padding:20px 24px;">
              <tr>
                <td>
                  <p style="margin:0 0 12px;font-size:14px;font-weight:800;color:#1e3a5f;text-transform:uppercase;letter-spacing:1px;">Your SEA Score — 100 Points</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr style="border-bottom:1px solid #dbeafe;">
                      <td style="padding:6px 0;font-size:13px;color:#374151;font-weight:600;">🏃 Habit Completion</td>
                      <td style="padding:6px 0;font-size:13px;color:#2563eb;font-weight:700;text-align:right;">30 pts</td>
                    </tr>
                    <tr style="border-bottom:1px solid #dbeafe;">
                      <td style="padding:6px 0;font-size:13px;color:#374151;font-weight:600;">🔨 Anvil Streak</td>
                      <td style="padding:6px 0;font-size:13px;color:#2563eb;font-weight:700;text-align:right;">25 pts</td>
                    </tr>
                    <tr style="border-bottom:1px solid #dbeafe;">
                      <td style="padding:6px 0;font-size:13px;color:#374151;font-weight:600;">⚖️ Wheel of John</td>
                      <td style="padding:6px 0;font-size:13px;color:#2563eb;font-weight:700;text-align:right;">20 pts</td>
                    </tr>
                    <tr style="border-bottom:1px solid #dbeafe;">
                      <td style="padding:6px 0;font-size:13px;color:#374151;font-weight:600;">📋 Weekly Ritual</td>
                      <td style="padding:6px 0;font-size:13px;color:#2563eb;font-weight:700;text-align:right;">15 pts</td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:13px;color:#374151;font-weight:600;">🎯 Goal Progress</td>
                      <td style="padding:6px 0;font-size:13px;color:#2563eb;font-weight:700;text-align:right;">10 pts</td>
                    </tr>
                  </table>
                  <p style="margin:12px 0 0;font-size:13px;color:#4b5563;line-height:1.5;">
                    <strong>Pro tip:</strong> Habits + Weekly Ritual = 45 pts. Nail those two consistently and you'll rarely dip below 70.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:28px 40px 8px;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">Open S.E.A. Dashboard →</a>
          </td>
        </tr>

        <!-- PDF note -->
        <tr>
          <td style="padding:16px 40px 8px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
              📎 Check the attachment — it's a full PDF guide with everything you need to get the most out of the app.
            </p>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding:24px 40px 32px;">
            <p style="margin:0 0 4px;font-size:15px;line-height:1.65;color:#374151;">Let me know if you have any questions — I'm here to help.</p>
            <p style="margin:16px 0 0;font-size:15px;font-weight:700;color:#111827;">— Gino</p>
            <p style="margin:2px 0 0;font-size:13px;color:#9ca3af;">Getting Results Inc. | S.E.A. Dashboard</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              © 2026 Getting Results Inc. · <a href="${APP_URL}" style="color:#6b7280;text-decoration:none;">sea-dashboard.netlify.app</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { email, name } = JSON.parse(event.body || '{}');

    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
    }

    const html = buildWelcomeEmail(name);
    const firstName = name ? name.split(' ')[0] : 'there';
    const pdfBase64 = getPdfBase64();

    const payload = {
      from: 'Gino from S.E.A. Dashboard <gino.coppola@gettingresultsinc.com>',
      to: [email],
      reply_to: 'gino.coppola@gettingresultsinc.com',
      subject: `Welcome to S.E.A. Dashboard, ${firstName} — here's how to get started`,
      html,
    };

    if (pdfBase64) {
      payload.attachments = [{
        filename: 'SEA-Dashboard-Getting-Started-Guide.pdf',
        content: pdfBase64,
      }];
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send email', detail: err }) };
    }

    const data = await res.json();
    console.log('Welcome email sent to', email, '— id:', data.id);
    return { statusCode: 200, body: JSON.stringify({ success: true, id: data.id }) };

  } catch (e) {
    console.error('welcome-email error:', e);
    require('./_lib/sentry').captureException(e, { fn: 'welcome-email' });
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
