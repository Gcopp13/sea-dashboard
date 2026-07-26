/**
 * reset-password.js
 * Sends a branded password reset email via Resend instead of Supabase's default.
 * Called from ForgotPasswordScreen in the app.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const ok  = (d)    => ({ statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(d) });
const err = (m, s) => ({ statusCode: s||500, headers: CORS_HEADERS, body: JSON.stringify({ error: m }) });

const resetEmailHTML = (resetUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px;">
      <!-- Header -->
      <tr>
        <td style="background:linear-gradient(135deg,#1e2a4a 0%,#2d1b69 100%);padding:40px 40px 32px;text-align:center;">
          <div style="font-size:2rem;font-weight:900;letter-spacing:-1px;color:white;">S.E.A.</div>
          <div style="color:#a78bfa;font-size:0.85rem;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Slight Edge Accelerator</div>
        </td>
      </tr>
      <!-- Body -->
      <tr>
        <td style="padding:40px;">
          <h2 style="color:#1e293b;font-size:1.5rem;margin:0 0 16px;">Reset your password</h2>
          <p style="color:#475569;line-height:1.7;margin:0 0 20px;">
            We received a request to reset the password for your S.E.A. Dashboard account.
            Click the button below to choose a new password.
          </p>
          <p style="color:#475569;line-height:1.7;margin:0 0 32px;">
            This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr>
              <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:16px 40px;text-align:center;">
                <a href="${resetUrl}" style="color:white;text-decoration:none;font-weight:700;font-size:1rem;letter-spacing:0.5px;">
                  Reset My Password &rarr;
                </a>
              </td>
            </tr>
          </table>
          <p style="color:#94a3b8;font-size:0.85rem;text-align:center;margin:0;">
            Live by design, not by default.
          </p>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background:#f8fafc;padding:24px 40px;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:0.8rem;margin:0;text-align:center;">
            You received this email because a password reset was requested for your S.E.A. Dashboard account.<br>
            Please do not reply to this email &mdash; this mailbox is not monitored.<br>
            <a href="https://sea-dashboard.netlify.app" style="color:#6366f1;">Getting Results Inc.</a> &middot; Coaching for Financial Advisors
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>
`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

  const SUPABASE_URL   = process.env.SUPABASE_URL;
  const SERVICE_KEY    = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const APP_URL        = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return err('Missing required environment variables', 500);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON', 400); }

  const { email } = body;
  if (!email) return err('email is required', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Invalid email address', 400);

  try {
    // Generate password reset link via Supabase admin API
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'recovery',
        email: email.trim(),
        options: { redirect_to: `${APP_URL}?reset_password=1` },
      }),
    });

    if (!linkRes.ok) {
      const linkErr = await linkRes.json();
      console.error('[reset-password] generate_link error:', linkErr);
      // Don't expose whether email exists — always return success to prevent enumeration
      return ok({ success: true });
    }

    const linkData = await linkRes.json();
    const resetUrl = linkData.action_link;

    if (!resetUrl) {
      console.error('[reset-password] No action_link returned');
      return ok({ success: true });
    }

    // Send branded email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SEA Dashboard <onboarding@gettingresultsinc.com>',
        to: [email.trim()],
        subject: 'Reset your S.E.A. Dashboard password',
        html: resetEmailHTML(resetUrl),
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.json();
      console.error('[reset-password] Resend error:', emailErr);
      // Don't surface this to user — link was generated, email failed silently
    }

    return ok({ success: true });

  } catch (e) {
    console.error('[reset-password] error:', e);
    require('./_lib/sentry').captureException(e, { fn: 'reset-password' });
    return ok({ success: true }); // Always return success to prevent email enumeration
  }
};
