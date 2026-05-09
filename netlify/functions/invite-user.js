/**
 * invite-user.js
 * Coach sends an invite to a user's email.
 * Sends a magic link that auto-connects them to the coach on landing.
 * Uses Supabase admin API to generate the invite link, then sends via Resend.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const ok  = (d)    => ({ statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(d) });
const err = (m, s) => ({ statusCode: s||500, headers: CORS_HEADERS, body: JSON.stringify({ error: m }) });

const inviteEmailHTML = (coachName, appUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>You've been invited</title>
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
          <h2 style="color:#1e293b;font-size:1.5rem;margin:0 0 16px;">You've been invited!</h2>
          <p style="color:#475569;line-height:1.7;margin:0 0 20px;">
            <strong>${coachName || 'Your coach'}</strong> has invited you to join the S.E.A. Dashboard &mdash; 
            a coaching and accountability platform built for financial advisors who want to live by design, not by default.
          </p>
          <p style="color:#475569;line-height:1.7;margin:0 0 32px;">
            Click the button below to accept your invitation and get started. No password needed &mdash; you'll set one up after your first login.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr>
              <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:16px 40px;text-align:center;">
                <a href="${appUrl}" style="color:white;text-decoration:none;font-weight:700;font-size:1rem;letter-spacing:0.5px;">
                  Accept Invitation &rarr;
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
            You received this invitation from ${coachName || 'your coach'} via the S.E.A. Dashboard.<br>
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

  const { email, coachId, coachName } = body;
  if (!email || !coachId) return err('email and coachId are required', 400);

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err('Invalid email address', 400);
  }

  try {
    // Use Supabase admin to generate a magic link invite
    // redirectTo includes the coachId so the app can auto-connect on landing
    const redirectTo = `${APP_URL}?coach=${encodeURIComponent(coachId)}&invite=1`;

    const inviteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        email_confirm: true,  // mark as confirmed immediately
        user_metadata: { invited_by_coach: coachId },
      }),
    });

    let invitedUserId = null;
    if (inviteRes.ok) {
      const inviteData = await inviteRes.json();
      invitedUserId = inviteData.id;
    } else {
      // User may already exist — that's fine, we'll still send the email
      const errBody = await inviteRes.json();
      // "User already registered" is not a fatal error
      if (!errBody.message?.includes('already')) {
        console.error('[invite-user] Supabase admin error:', errBody);
      }
    }

    // Generate magic link for login
    const magicRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'magiclink',
        email,
        options: { redirect_to: redirectTo },
      }),
    });

    if (!magicRes.ok) {
      const magicErr = await magicRes.json();
      console.error('[invite-user] Magic link generation failed:', magicErr);
      return err('Failed to generate invite link. Please try again.', 500);
    }

    const magicData = await magicRes.json();
    const inviteLink = magicData.action_link || magicData.hashed_token;

    if (!inviteLink) {
      return err('No invite link returned from auth service', 500);
    }

    // Send the invite email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SEA Dashboard <onboarding@gettingresultsinc.com>',
        to: [email],
        subject: `${coachName || 'Your coach'} has invited you to the S.E.A. Dashboard`,
        html: inviteEmailHTML(coachName, inviteLink),
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.json();
      console.error('[invite-user] Resend error:', emailErr);
      return err('Failed to send invite email. Please try again.', 500);
    }

    return ok({ success: true, message: `Invitation sent to ${email}` });

  } catch (e) {
    console.error('[invite-user] error:', e);
    return err(e.message, 500);
  }
};
