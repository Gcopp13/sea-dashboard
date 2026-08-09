/**
 * weekly-summary.js
 * Automated weekly summary email for all users.
 * Called by cron every Sunday at 8 AM EDT (12:00 UTC).
 * Fetches all profiles + planner data from Supabase, sends summary via Resend.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Score calculation — scores the LAST COMPLETED week (not current in-progress week) ──
function calcSEAScore(data) {
  const weeks = Array.isArray(data.weeks) ? data.weeks : [];

  // Weekly summary fires Sunday — score the week that just ENDED (Mon-Sat).
  // The user may have already filled in the Sunday ritual for the NEW week this morning,
  // so we use the second-most-recent week with wins/focus data (= last completed week).
  const weeksWithData = weeks.map((w, i) => ({ w, i })).filter(({ w }) =>
    w && (w.wins?.some(x => x?.trim()) || w.focus?.trim())
  );
  if (weeksWithData.length === 0) return null;
  // Second-to-last = last completed week; if only one exists, use it
  const completedEntry = weeksWithData.length >= 2
    ? weeksWithData[weeksWithData.length - 2]
    : weeksWithData[weeksWithData.length - 1];
  const recentWeek = completedEntry.w;

  // 1. Habit completion (30pts) — use the same completed week's habit data
  const acts = (recentWeek.aActivities || []).filter(a => a?.name?.trim());
  const habitPct = acts.length > 0
    ? acts.reduce((s, a) => {
        const target = Math.min(Math.max(parseInt(a.targetDays) || 7, 1), 7);
        const done = (a.days || []).filter(Boolean).length;
        return s + Math.min(done / target, 1);
      }, 0) / acts.length
    : 0;
  const habitScore = habitPct * 30;

  // 2. Anvil (25pts) — score LAST completed week's logs (Mon-Sun of last week)
  const anvilLog = Array.isArray(data.anvilProject?.log) ? data.anvilProject.log : [];
  const freqCount = Math.max(1, parseInt(data.anvilProject?.freqCount) || 1);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const dow = (now.getDay() + 6) % 7; // 0=Mon
  const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - dow);
  const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart); lastWeekEnd.setDate(thisWeekStart.getDate() - 1); lastWeekEnd.setHours(23, 59, 59, 999);
  const logsLastWeek = anvilLog.filter(e => {
    const d = new Date(e.date); d.setHours(0, 0, 0, 0);
    return d >= lastWeekStart && d <= lastWeekEnd;
  }).length;
  const anvilScore = Math.min(logsLastWeek / freqCount, 1) * 25;

  // 3. Wheel (20pts)
  const w = recentWeek.wheelOfJohn || { family: 5, fun: 5, fitness: 5, finance: 5, faith: 5 };
  const wheelAvg = Object.values(w).reduce((a, b) => a + (b || 5), 0) / Object.values(w).length;
  const wheelScore = (wheelAvg / 10) * 20;

  // 4. Weekly ritual (15pts)
  const ritualDone = recentWeek.wins?.some(x => x?.trim()) &&
    recentWeek.focus?.trim() &&
    recentWeek.goalPriorities?.some(x => x?.trim());
  const ritualScore = ritualDone ? 15 : 0;

  // 5. Goals (10pts)
  const goals = (data.goals || []).filter(g => g?.title?.trim());
  const goalAvg = goals.length > 0 ? goals.reduce((s, g) => s + (g.completion || 0), 0) / goals.length : 0;
  const goalScore = (goalAvg / 100) * 10;

  return Math.round(habitScore + anvilScore + wheelScore + ritualScore + goalScore);
}

// ── Email HTML builder ───────────────────────────────────────────────────────
function buildEmailHtml(name, data) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const seaScore = calcSEAScore(data);
  const weeks = Array.isArray(data.weeks) ? data.weeks : [];
  // Same logic as calcSEAScore — use second-most-recent week (last completed week)
  const weeksWithDataE = weeks.map((w, i) => ({ w, i })).filter(({ w }) =>
    w && (w.wins?.some(x => x?.trim()) || w.focus?.trim())
  );
  const completedEntryE = weeksWithDataE.length >= 2
    ? weeksWithDataE[weeksWithDataE.length - 2]
    : weeksWithDataE[weeksWithDataE.length - 1];
  const recentWeek = completedEntryE?.w || null;

  const wins = recentWeek?.wins?.filter(w => w?.trim()) || [];
  const goals = (data.goals || []).filter(g => g?.title?.trim());
  const yearTheme = data.yearTheme || '';
  const weekFocus = recentWeek?.focus || '';
  const anvilProject = data.anvilProject?.project || '';
  const slightEdge = data.slightEdge || '';

  const scoreColor = seaScore === null ? '#94a3b8' : seaScore >= 80 ? '#22c55e' : seaScore >= 60 ? '#eab308' : '#ef4444';
  const scoreDisplay = seaScore !== null ? `${seaScore} / 100` : 'Not yet calculated';

  const winsHtml = wins.length > 0
    ? wins.map(w => `<li style="margin-bottom:6px;color:#e2e8f0;">${escapeHtml(w)}</li>`).join('')
    : '<li style="color:#94a3b8;font-style:italic;">No wins recorded last week</li>';

  const goalsHtml = goals.length > 0
    ? goals.map(g => `<div style="padding:10px 14px;background:#1e293b;border-radius:8px;margin-bottom:8px;border-left:3px solid #6366f1;"><span style="color:#e2e8f0;font-size:14px;">${escapeHtml(g.title)}</span><span style="color:#64748b;font-size:12px;float:right;">${g.completion || 0}%</span></div>`).join('')
    : '<p style="color:#94a3b8;font-style:italic;font-size:14px;">No goals set yet</p>';

  const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#1e2a4a 0%,#2d1b69 100%);padding:32px;border-radius:16px 16px 0 0;text-align:center;">
        <div style="font-size:2rem;font-weight:900;letter-spacing:-1px;color:white;">S.E.A.</div>
        <div style="color:#a78bfa;font-size:0.8rem;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Slight Edge Accelerator</div>
        <div style="color:#94a3b8;font-size:0.8rem;margin-top:4px;">Weekly Summary</div>
      </td></tr>
      <tr><td style="background:#1e293b;padding:32px;border-radius:0 0 16px 16px;">
        <p style="font-size:20px;font-weight:700;color:#f1f5f9;margin:0 0 8px;">Hey ${escapeHtml(firstName)},</p>
        <p style="font-size:15px;color:#94a3b8;margin:0 0 28px;line-height:1.6;">Here's your weekly snapshot. Small edges compounded over time — that's the game.</p>

        ${yearTheme ? `<div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;text-align:center;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:4px;">Year Theme</div>
          <div style="font-size:18px;font-weight:700;color:#818cf8;">${escapeHtml(yearTheme)}</div>
        </div>` : ''}

        <div style="background:#0f172a;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #334155;text-align:center;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">Last Week's S.E.A. Score</div>
          <div style="font-size:48px;font-weight:800;color:${scoreColor};">${scoreDisplay}</div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;margin-bottom:12px;">Top Wins Last Week</div>
          <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">${winsHtml}</ul>
        </div>

        ${weekFocus ? `<div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Last Week's Focus</div>
          <div style="font-size:14px;color:#e2e8f0;line-height:1.5;">${escapeHtml(weekFocus)}</div>
        </div>` : ''}

        ${anvilProject ? `<div style="background:#0f172a;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #334155;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:4px;">Anvil — ${escapeHtml(anvilProject)}</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:4px;">Keep showing up. The streak is built one period at a time.</div>
        </div>` : ''}

        <div style="margin-bottom:20px;">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;margin-bottom:12px;">Your 120-Day Goals</div>
          ${goalsHtml}
        </div>

        ${slightEdge ? `<div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Your Slight Edge</div>
          <div style="font-size:13px;color:#cbd5e1;line-height:1.6;">${escapeHtml(slightEdge)}</div>
        </div>` : ''}

        <div style="text-align:center;margin-top:28px;">
          <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Open My Dashboard →</a>
        </div>

        <p style="color:#475569;font-size:12px;text-align:center;margin-top:24px;line-height:1.6;">
          This email was sent automatically every Sunday.<br>
          Please do not reply — this mailbox is not monitored.<br>
          <a href="${APP_URL}" style="color:#6366f1;">Getting Results Inc.</a> · Coaching for Financial Advisors
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS_HEADERS, body: '' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // 1. Fetch all profiles
    const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,email,full_name`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
    });
    const profiles = await profilesRes.json();
    if (!Array.isArray(profiles) || profiles.length === 0) {
      return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ sent: 0, message: 'No users found' }) };
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    let sent = 0;
    let errors = 0;
    const results = [];

    for (const profile of profiles) {
      if (!profile.email) continue;

      try {
        // 2. Fetch planner data for this user
        const plannerRes = await fetch(
          `${SUPABASE_URL}/rest/v1/planner_data?user_id=eq.${encodeURIComponent(profile.id)}&select=data&limit=1`,
          { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } }
        );
        const plannerRows = await plannerRes.json();
        const plannerData = plannerRows?.[0]?.data || {};

        // 3. Build and send email
        const html = buildEmailHtml(profile.full_name || profile.email, plannerData);
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            // Netlify scheduled functions can fire more than once (at-least-once delivery). A
            // deterministic key per user+day makes a double-fire a no-op — Resend dedupes it for 24h.
            'Idempotency-Key': `weekly-summary-${profile.id}-${new Date().toISOString().slice(0,10)}`,
          },
          body: JSON.stringify({
            from: 'SEA Dashboard <onboarding@gettingresultsinc.com>',
            to: [profile.email],
            subject: `Your S.E.A. Weekly Summary`,
            html,
          }),
        });

        if (emailRes.ok) {
          sent++;
          results.push({ email: profile.email, status: 'sent' });
        } else {
          const emailErr = await emailRes.json();
          errors++;
          results.push({ email: profile.email, status: 'error', error: emailErr.message });
          console.error(`[weekly-summary] Failed to send to ${profile.email}:`, emailErr);
        }
        // Pause between sends to stay under Resend's 5 req/sec rate limit
        await sleep(250);
      } catch (userErr) {
        errors++;
        results.push({ email: profile.email, status: 'error', error: userErr.message });
        console.error(`[weekly-summary] Error processing ${profile.email}:`, userErr.message);
      }
    }

    console.log(`[weekly-summary] Done — sent: ${sent}, errors: ${errors}`);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ sent, errors, total: profiles.length, results }),
    };

  } catch (e) {
    console.error('[weekly-summary] Fatal error:', e);
    require('./_lib/sentry').captureException(e, { fn: 'weekly-summary' });
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
