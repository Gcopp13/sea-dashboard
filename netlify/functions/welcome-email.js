/**
 * welcome-email.js — Sends a welcome email when a new user signs up
 * Uses Resend API directly via fetch (no npm dependencies needed).
 *
 * Called from the front-end after first successful login.
 * POST { email, name }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}
function err(message, statusCode = 500) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

const welcomeHTML = (name, appUrl) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1a1f3c 0%,#2d1b69 100%);border-radius:12px 12px 0 0;padding:40px;text-align:center;">
          <div style="font-size:40px;margin-bottom:12px;">🌊</div>
          <h1 style="color:#ffffff;margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">S.E.A. Dashboard</h1>
          <p style="color:#a78bfa;margin:8px 0 0;font-size:15px;font-style:italic;">Live By Design, Not By Default</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:40px;">
          <h2 style="color:#1a1f3c;margin:0 0 16px;font-size:22px;">Welcome${name ? ', ' + name : ''}.</h2>
          <p style="color:#4b5563;font-size:16px;line-height:1.6;margin:0 0 20px;">
            You've just taken the first step toward running your practice with intention. The S.E.A. Framework — <strong>Strategic, Executable, Accountable</strong> — is about 5 minutes a day that compounds into something significant.
          </p>

          <!-- 3 steps -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr>
              <td style="background:#f8f7ff;border-left:4px solid #7c3aed;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:12px;">
                <p style="margin:0;color:#1a1f3c;font-weight:600;font-size:15px;">1. Set your foundation</p>
                <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">Define your Slight Edge habits, 120-Day Vision, and Anvil project.</p>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="background:#f8f7ff;border-left:4px solid #7c3aed;border-radius:0 8px 8px 0;padding:16px 20px;">
                <p style="margin:0;color:#1a1f3c;font-weight:600;font-size:15px;">2. Plan your week</p>
                <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">Use the Weekly Ritual every Sunday to set your focus and score your previous week.</p>
              </td>
            </tr>
            <tr><td style="height:8px;"></td></tr>
            <tr>
              <td style="background:#f8f7ff;border-left:4px solid #7c3aed;border-radius:0 8px 8px 0;padding:16px 20px;">
                <p style="margin:0;color:#1a1f3c;font-weight:600;font-size:15px;">3. Use your AI Coach</p>
                <p style="margin:4px 0 0;color:#6b7280;font-size:14px;">Your coach knows your goals and holds you accountable. Ask it anything.</p>
              </td>
            </tr>
          </table>

          <p style="color:#4b5563;font-size:15px;line-height:1.6;margin:24px 0;">
            Structure sets you free. Let's build yours.
          </p>

          <!-- CTA Button -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0 24px;">
              <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 36px;border-radius:8px;letter-spacing:0.3px;">
                Open Your Dashboard →
              </a>
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f4f4f7;border-radius:0 0 12px 12px;padding:24px;text-align:center;">
          <p style="color:#9ca3af;font-size:13px;margin:0;">Getting Results Inc. · S.E.A. Dashboard</p>
          <p style="color:#9ca3af;font-size:12px;margin:6px 0 0;">You received this because you signed up at sea-dashboardindex18.netlify.app</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>
`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  let payload;
  try { payload = JSON.parse(event.body); } catch { return err('Invalid JSON', 400); }

  const { email, name } = payload;
  if (!email) return err('email is required', 400);

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const appUrl = process.env.APP_URL || 'https://sea-dashboardindex18.netlify.app';

  if (!apiKey) return err('RESEND_API_KEY not configured', 500);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `S.E.A. Dashboard <${fromEmail}>`,
        to: [email],
        subject: 'Welcome to S.E.A. Dashboard — Live By Design',
        html: welcomeHTML(name, appUrl),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[welcome-email] Resend error:', data);
      return err(data.message || 'Failed to send email', res.status);
    }
    return ok({ success: true, id: data.id });
  } catch (e) {
    console.error('[welcome-email] fetch error:', e);
    return err(e.message);
  }
};
