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

// ── Which week are we summarising, and what did it score? ────────────────────
// Rewritten 2026-11-15. This used to pick "the second-most-recent week that has
// any data", never looking at the calendar — so because the weekly ritual
// pre-creates NEXT week, the email reported a week that was already over, and
// drifted further back the more someone planned ahead. It also still used the
// retired scoring model (habits 30 / Anvil 25 / Wheel 20 / ritual 15 / goals 10)
// so its number never matched the app's.
// Now: the week is chosen BY DATE (the Mon–Sun week that today falls in, i.e. the
// one the ritual is about to close), and the score mirrors index.html's engine —
// #1 = 40, Anvil = 30, habits = 30, scored per day, averaged over the days that
// have happened, +5 for the ritual. Keep the two in step when either changes.
const SCORE_WEIGHTS = { hero: 40, anvil: 30, habits: 30 };
const RITUAL_BONUS = 5;

function habitSchedule(a) {
  return Array.isArray(a && a.scheduleDays) ? a.scheduleDays.filter(d => d >= 0 && d <= 6) : [];
}
function habitTarget(a) {
  const sched = habitSchedule(a);
  if (sched.length) return sched.length;
  return Math.min(Math.max(parseInt(a && a.targetDays, 10) || 7, 1), 7);
}
function sameCalDay(a, b) {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// Local-midnight Monday starting week `weekIdx` (0-based), anchored to the first
// Monday on/after startDate — the same anchor the app uses.
function weekMondayDate(data, weekIdx) {
  if (!data || !data.startDate) return null;
  const parts = String(data.startDate).split('-').map(Number);
  if (parts.length < 3 || !parts[0]) return null;
  const start = new Date(parts[0], parts[1] - 1, parts[2]);
  const sd = start.getDay();
  if (sd !== 1) start.setDate(start.getDate() + (sd === 0 ? 1 : 8 - sd));
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + weekIdx * 7);
  return start;
}
// The week today sits in: the one the user is closing out.
function currentWeekIdx(data, now) {
  const first = weekMondayDate(data, 0);
  if (!first) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const idx = Math.floor((today - first) / 86400000 / 7);
  return idx >= 0 ? idx : null;
}

function calcDayScore(data, weekIdx, dayIdx) {
  const week = (data.weeks || [])[weekIdx] || null;
  const day = ((data.dailyPlans || [])[weekIdx] || [])[dayIdx] || null;
  const monday = weekMondayDate(data, weekIdx);
  const dayDate = monday ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + dayIdx) : null;

  const heroDone = !!(day && day.topPriorityDone);
  const parts = [{ key: 'hero', pts: SCORE_WEIGHTS.hero, earned: heroDone ? SCORE_WEIGHTS.hero : 0, owed: true }];

  const anvil = data.anvilProject || {};
  const log = Array.isArray(anvil.log) ? anvil.log : [];
  const loggedOn = dt => !!dt && log.some(e => e && sameCalDay(new Date(e.date), dt));
  const useSpecific = !!(anvil.useSpecificDays && (anvil.specificDays || []).length > 0);
  const freqCount = Math.max(1, parseInt(anvil.freqCount, 10) || 1);
  const anvilDone = loggedOn(dayDate);
  let anvilOwed;
  if (!anvil.project) anvilOwed = false;
  else if (useSpecific) anvilOwed = anvil.specificDays.indexOf(dayIdx) !== -1;
  else {
    let before = 0;
    if (monday) for (let i = 0; i < dayIdx; i++) {
      if (loggedOn(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))) before++;
    }
    anvilOwed = before < freqCount;
  }
  parts.push({ key: 'anvil', pts: SCORE_WEIGHTS.anvil, earned: anvilDone ? SCORE_WEIGHTS.anvil : 0, owed: anvilOwed || anvilDone });

  const acts = ((week && week.aActivities) || []).filter(a => a && a.name && a.name.trim());
  let owedCount = 0, doneCount = 0;
  acts.forEach(a => {
    const days = a.days || [];
    const scheduled = habitSchedule(a).length > 0;
    if (scheduled && habitSchedule(a).indexOf(dayIdx) === -1) return;
    if (!scheduled) {
      let before = 0;
      for (let i = 0; i < dayIdx; i++) if (days[i]) before++;
      if (before >= habitTarget(a)) return;
    }
    owedCount++;
    if (days[dayIdx]) doneCount++;
  });
  parts.push({ key: 'habits', pts: SCORE_WEIGHTS.habits, earned: owedCount > 0 ? (doneCount / owedCount) * SCORE_WEIGHTS.habits : 0, owed: owedCount > 0 });

  const live = parts.filter(p => p.owed);
  const maxPts = live.reduce((s, p) => s + p.pts, 0);
  const earned = live.reduce((s, p) => s + p.earned, 0);
  return maxPts > 0 ? Math.round((earned / maxPts) * 100) : 0;
}

// Returns { idx, week, score, label } for the week being summarised, or null.
function pickWeek(data, now) {
  const weeks = Array.isArray(data.weeks) ? data.weeks : [];
  if (!weeks.length) return null;
  let idx = currentWeekIdx(data, now);
  // No start date (older accounts): fall back to the last week holding real data.
  if (idx === null) {
    for (let i = weeks.length - 1; i >= 0; i--) {
      const w = weeks[i];
      if (w && ((w.wins || []).some(x => x && x.trim()) || (w.focus || '').trim())) { idx = i; break; }
    }
    if (idx === null) return null;
  }
  if (idx >= weeks.length) idx = weeks.length - 1;
  const week = weeks[idx] || null;
  const monday = weekMondayDate(data, idx);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let elapsed = 7;
  if (monday) elapsed = Math.max(1, Math.min(7, Math.floor((today - monday) / 86400000) + 1));

  let score = null;
  if (week) {
    let sum = 0;
    for (let d = 0; d < elapsed; d++) sum += calcDayScore(data, idx, d);
    const ritualDone = !!((week.wins || []).some(x => x && x.trim()) && (week.focus || '').trim()
      && (week.goalPriorities || []).some(x => x && x.trim()));
    score = Math.min(100, Math.round(sum / elapsed + (ritualDone ? RITUAL_BONUS : 0)));
  }

  let label = '';
  if (monday) {
    const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    label = `Week ${idx + 1} · ${fmt(monday)} – ${fmt(end)}`;
  }
  return { idx, week, score, label };
}

// ── Email HTML builder ───────────────────────────────────────────────────────
function buildEmailHtml(name, data) {
  const firstName = name ? name.split(' ')[0] : 'there';
  // One source of truth: the calendar week being closed out, its score, and its label.
  const picked = pickWeek(data, new Date());
  const seaScore = picked ? picked.score : null;
  const weekLabel = picked ? picked.label : '';
  const recentWeek = picked ? picked.week : null;

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
    : '<li style="color:#94a3b8;font-style:italic;">No wins recorded for this week yet</li>';

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
        ${weekLabel ? `<div style="color:#c7d2fe;font-size:0.8rem;margin-top:10px;font-weight:600;">${escapeHtml(weekLabel)}</div>` : ''}
      </td></tr>
      <tr><td style="background:#1e293b;padding:32px;border-radius:0 0 16px 16px;">
        <p style="font-size:20px;font-weight:700;color:#f1f5f9;margin:0 0 8px;">Hey ${escapeHtml(firstName)},</p>
        <p style="font-size:15px;color:#94a3b8;margin:0 0 28px;line-height:1.6;">Here's your weekly snapshot. Small edges compounded over time — that's the game.</p>

        ${yearTheme ? `<div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;text-align:center;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:4px;">Year Theme</div>
          <div style="font-size:18px;font-weight:700;color:#818cf8;">${escapeHtml(yearTheme)}</div>
        </div>` : ''}

        <div style="background:#0f172a;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #334155;text-align:center;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">${weekLabel ? 'This Week\'s S.E.A. Score' : "Last Week's S.E.A. Score"}</div>
          <div style="font-size:48px;font-weight:800;color:${scoreColor};">${scoreDisplay}</div>
        </div>

        <div style="margin-bottom:20px;">
          <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;margin-bottom:12px;">Top Wins This Week</div>
          <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">${winsHtml}</ul>
        </div>

        ${weekFocus ? `<div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">This Week's Focus</div>
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
          <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">New week ahead — take a few minutes to plan it.</p>
          <a href="${APP_URL}?tab=more&section=weekly" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">Plan This Week's Ritual →</a>
          <div style="margin-top:12px;">
            <a href="${APP_URL}" style="color:#94a3b8;text-decoration:none;font-size:13px;">or just open the dashboard</a>
          </div>
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

    let skippedDay = 0;
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

        // 2b. Only send on the day this user actually closes their week. The cron
        // fires Sat and Sun; ritualDay is 0=Mon…6=Sun and defaults to Sunday.
        const todayIdx = (new Date().getUTCDay() + 6) % 7;
        const rd = parseInt(plannerData.ritualDay);
        const ritualDay = (rd >= 0 && rd <= 6) ? rd : 6;
        if (ritualDay !== todayIdx) { skippedDay++; continue; }

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

    console.log(`[weekly-summary] Done — sent: ${sent}, errors: ${errors}, not-their-ritual-day: ${skippedDay}`);
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ sent, errors, skippedDay, total: profiles.length, results }),
    };

  } catch (e) {
    console.error('[weekly-summary] Fatal error:', e);
    require('./_lib/sentry').captureException(e, { fn: 'weekly-summary' });
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
