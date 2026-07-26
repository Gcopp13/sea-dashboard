/**
 * re-engagement.js
 * Checks for users who haven't been seen in 24+ hours and sends a re-engagement email.
 * Also skips users who were already emailed in the last 24h (re_engagement_sent_at).
 * Designed to be called daily via a scheduled cron or direct HTTP POST.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const ok  = (d)    => ({ statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(d) });
const err = (m, s) => ({ statusCode: s||500, headers: CORS_HEADERS, body: JSON.stringify({ error: m }) });

const reEngagementHTML = (name, appUrl) => `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>We miss you</title>
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
          <h2 style="color:#1e293b;font-size:1.5rem;margin:0 0 16px;">Hey ${name || 'there'} — your momentum is waiting</h2>
          <p style="color:#475569;line-height:1.7;margin:0 0 20px;">
            Small, consistent actions create big results — that's the Slight Edge. It only takes a moment to check in and keep your progress moving forward.
          </p>
          <p style="color:#475569;line-height:1.7;margin:0 0 32px;">
            Log your wins, update your goals, or just take a quick look at where you stand. Every check-in counts.
          </p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr>
              <td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;padding:16px 40px;text-align:center;">
                <a href="${appUrl}" style="color:white;text-decoration:none;font-weight:700;font-size:1rem;letter-spacing:0.5px;">
                  Return to Your Dashboard →
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
            You're receiving this because you have an account on the S.E.A. Dashboard.<br>
            <a href="${appUrl}" style="color:#6366f1;">Getting Results Inc.</a> · Coaching for Financial Advisors
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

  const SUPABASE_URL    = process.env.SUPABASE_URL;
  const SERVICE_KEY     = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY  = process.env.RESEND_API_KEY;
  const APP_URL         = process.env.APP_URL || 'https://sea-dashboard.netlify.app';
  const FROM_EMAIL      = 'SEA Dashboard <onboarding@gettingresultsinc.com>';

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return err('Missing required environment variables', 500);
  }

  const serviceHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(); // 24h ago

    // Find users who:
    // 1. Have a last_seen set
    // 2. Haven't been seen in 24h
    // 3. Haven't already been sent a re-engagement email in the last 24h
    const query = `${SUPABASE_URL}/rest/v1/profiles?select=id,email,full_name,last_seen,re_engagement_sent_at` +
      `&last_seen=lt.${cutoff}` +
      `&last_seen=not.is.null`;

    const res = await fetch(query, { headers: serviceHeaders });
    if (!res.ok) {
      const text = await res.text();
      return err(`Supabase query failed: ${text}`, 500);
    }

    const users = await res.json();

    // Filter out users who already got an email in the last 24h
    const eligible = users.filter(u => {
      if (!u.re_engagement_sent_at) return true;
      const sentAt = new Date(u.re_engagement_sent_at);
      return (now - sentAt) > 24 * 60 * 60 * 1000;
    });

    const results = [];

    for (const user of eligible) {
      try {
        // Send re-engagement email
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [user.email],
            subject: 'Your Slight Edge is waiting — check in today',
            html: reEngagementHTML(user.full_name || user.email.split('@')[0], APP_URL),
          }),
        });

        if (emailRes.ok) {
          // Update re_engagement_sent_at so we don't email again for 24h
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: { ...serviceHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ re_engagement_sent_at: now.toISOString() }),
          });
          results.push({ email: user.email, status: 'sent' });
        } else {
          const errText = await emailRes.text();
          results.push({ email: user.email, status: 'failed', error: errText });
        }
      } catch (emailErr) {
        results.push({ email: user.email, status: 'error', error: emailErr.message });
      }
    }

    return ok({
      checked: users.length,
      eligible: eligible.length,
      results,
      timestamp: now.toISOString(),
    });

  } catch (e) {
    console.error('[re-engagement] error:', e);
    require('./_lib/sentry').captureException(e, { fn: 're-engagement' });
    return err(e.message, 500);
  }
};
