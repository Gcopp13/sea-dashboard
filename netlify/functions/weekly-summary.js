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

// ── Score calculation (mirrors calcSEAScore in index.html) ───────────────────
function calcSEAScore(data) {
  const weeks = Array.isArray(data.weeks) ? data.weeks : [];
  const recentWeek = [...weeks].reverse().find(w => w && (w.wins?.some(x => x?.trim()) || w.focus?.trim())) || null;
  if (!recentWeek) return null;
  // Use most recent week with actual habit data (may differ from recentWeek)
  const latestHabitWeek = [...weeks].reverse().find(w => w && (w.aActivities || []).some(a => a?.name?.trim())) || recentWeek;

  // 1. Habit completion (30pts)
  const acts = (latestHabitWeek.aActivities || []).filter(a => a?.name?.trim());
  const habitPct = acts.length > 0
    ? acts.reduce((s, a) => {
        const target = Math.min(Math.max(parseInt(a.targetDays) || 7, 1), 7);
        const done = (a.days || []).filter(Boolean).length;
        return s + Math.min(done / target, 1);
      }, 0) / acts.length
    : 0;
  const habitScore = habitPct * 30;

  // 2. Anvil (25pts) — period-based
  const anvilLog = Array.isArray(data.anvilProject?.log) ? data.anvilProject.log : [];
  const freqCount = Math.max(1, parseInt(data.anvilProject?.freqCount) || 1);
  const freqPeriod = data.anvilProject?.freqPeriod || 'week';
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const getPeriodStart = (stepsBack) => {
    const d = new Date(now);
    if (freqPeriod === 'week') {
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - stepsBack * 7);
    } else if (freqPeriod === 'biweekly') {
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - stepsBack * 14);
    } else {
      return new Date(d.getFullYear(), d.getMonth() - stepsBack, 1);
    }
    return d;
  };
  const curStart = getPeriodStart(0);
  const curEnd = new Date(); curEnd.setHours(23, 59, 59, 999);
  const logsThisPeriod = anvilLog.filter(e => { const d = new Date(e.date); return d >= curStart && d <= curEnd; }).length;
  const hitCurrent = logsThisPeriod >= freqCount;
  let anvilStreak = hitCurrent ? 1 : 0;
  if (hitCurrent) {
    for (let i = 1; i <= 52; i++) {
      const s = getPeriodStart(i);
      const ePrev = new Date(getPeriodStart(i - 1)); ePrev.setDate(ePrev.getDate() - 1); ePrev.setHours(23, 59, 59, 999);
      const cnt = anvilLog.filter(e => { const d = new Date(e.date); return d >= s && d <= ePrev; }).length;
      if (cnt >= freqCount) anvilStreak++; else break;
    }
  }
  const anvilScore = hitCurrent ? 25 : Math.min(anvilStreak / 4, 1) * 25;

  // 3. Wheel (20pts)
  const w = recentWeek.wheelOfJohn || { family: 5, fun: 5, fitness: 5, finance: 5, faith: 5 };
  const wheelAvg = Object.values(w).reduce((a, b) => a + (b || 5), 0) / 5;
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
  const recentWeek = [...weeks].reverse().find(w => w && (w.wins?.some(x => x?.trim()) || w.focus?.trim())) || null;

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
    : '<li style="color:#94a3b8;font-style:italic;">No wins recorded this week yet</li>';

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
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">This Week's S.E.A. Score</div>
          <div style="font-size:48px;font-weight:800;color:${scoreColor};">${scoreDisplay}</div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;margin-bottom:12px;">Top Wins This Week</div>
          <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">${winsHtml}</ul>
        </div>

        ${weekFocus ? `<div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Week Focus</div>
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
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
