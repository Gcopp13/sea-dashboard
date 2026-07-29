/**
 * cycle-heads-up.js
 * Week-ahead heads-up email for the 120-day completion experience.
 * Intended to run weekly (Mondays) — emails each user who has just entered the FINAL
 * week (week 17) of their cycle and hasn't already chosen to continue, letting them know
 * the reset-or-continue moment arrives this Sunday.
 *
 * NOTE: no cron schedule is declared in netlify.toml yet — this stays dormant (never fires
 * on its own) until the 120-day feature is turned on. It can also be invoked manually.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

const CYCLE_WEEKS = 17;

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Which 120-day week is `startDate` in today? Weeks are Monday-anchored (first Monday on/after
// the start date), matching the client's getCycleContext — so week 17 always begins on a Monday.
function cycleWeek(startDate) {
  if (!startDate) return 0;
  const [y, m, d] = String(startDate).split('-').map(Number);
  if (!y || !m || !d) return 0;
  const start = new Date(Date.UTC(y, m - 1, d));
  const dow = start.getUTCDay();
  if (dow !== 1) { const adj = dow === 0 ? 1 : 8 - dow; start.setUTCDate(start.getUTCDate() + adj); }
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.max(1, Math.floor((today - start) / (24 * 60 * 60 * 1000) / 7) + 1);
}

function buildHeadsUpEmail(name) {
  const firstName = name ? String(name).split(' ')[0] : 'there';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Final week of your cycle</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr><td style="background:linear-gradient(135deg,#5b21b6 0%,#7c3aed 100%);padding:34px 40px 26px;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.75);">Final week</p>
        <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">You're in the last week of your 120 days</h1>
      </td></tr>
      <tr><td style="padding:26px 40px 8px;">
        <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1e293b;">${esc(firstName)}, you're in the final stretch of this 120-day cycle. <strong>This Sunday</strong>, when you sit down for your weekly ritual, you'll get to choose:</p>
        <p style="margin:0 0 8px;font-size:15px;color:#334155;">➡️ <strong>Keep going</strong> — roll straight into your next week, streaks intact.</p>
        <p style="margin:0 0 14px;font-size:15px;color:#334155;">✨ <strong>Start fresh</strong> — close these 120 days with a recap and begin a clean cycle (your streak still carries forward).</p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">Between now and Sunday, start reflecting: what did these 120 days build, and who do you want to become in the next 120?</p>
      </td></tr>
      <tr><td style="padding:22px 40px 36px;">
        <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">Open your dashboard →</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

exports.handler = async () => {
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Not configured' }) };
  }
  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  try {
    const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,email,full_name`, { headers: sbHeaders });
    const profiles = await profilesRes.json();
    if (!Array.isArray(profiles)) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not load profiles' }) };
    }

    const results = [];
    for (const profile of profiles) {
      if (!profile.email) continue;
      try {
        const pdRes = await fetch(
          `${SUPABASE_URL}/rest/v1/planner_data?user_id=eq.${encodeURIComponent(profile.id)}&select=data&limit=1`,
          { headers: sbHeaders }
        );
        const rows = await pdRes.json();
        const data = Array.isArray(rows) && rows[0] && rows[0].data ? rows[0].data : null;
        if (!data || !data.startDate) continue;
        if (data.cycleContinued) continue;            // already chose to keep going — no nudge
        if (cycleWeek(data.startDate) !== CYCLE_WEEKS) continue; // only those in the final week

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Gino from S.E.A. Dashboard <gino.coppola@gettingresultsinc.com>',
            to: [profile.email],
            reply_to: 'gino.coppola@gettingresultsinc.com',
            subject: 'Your 120-day cycle wraps up this Sunday',
            html: buildHeadsUpEmail(profile.full_name || profile.email),
          }),
        });
        results.push({ email: profile.email, status: emailRes.ok ? 'sent' : 'error' });
        if (!emailRes.ok) console.error('[cycle-heads-up] send failed for', profile.email, await emailRes.text());
      } catch (userErr) {
        console.error('[cycle-heads-up] error for', profile.email, userErr.message);
        results.push({ email: profile.email, status: 'error' });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    console.log(`[cycle-heads-up] final-week heads-up sent: ${sent}`);
    return { statusCode: 200, body: JSON.stringify({ sent, total: profiles.length, results }) };
  } catch (e) {
    console.error('[cycle-heads-up] error:', e);
    try { require('./_lib/sentry').captureException(e, { fn: 'cycle-heads-up' }); } catch (_) {}
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
