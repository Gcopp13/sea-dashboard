// coach-nudge-push.js — hourly check: push coach nudge if user inactive 6+ hours
// Cron: 0 * * * * (every hour)

const { sendPush } = require('./send-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabaseHeaders = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

exports.handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('coach-nudge-push: missing env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  // Get all coach_nudge subscribers
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?coach_nudge=eq.true&select=*`,
    { headers: supabaseHeaders }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('coach-nudge-push fetch error:', text);
    require('./_lib/sentry').captureException(text, { fn: 'coach-nudge-push' });
    return { statusCode: 500, body: JSON.stringify({ error: text }) };
  }

  const subs = await res.json();

  if (!subs || subs.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ checked: 0, sent: 0 }) };
  }

  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  let errors = 0;
  const expired = [];

  for (const sub of subs) {
    checked++;

    // Fetch profile for last_seen and re_engagement_sent_at
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${sub.user_id}&select=id,last_seen,re_engagement_sent_at`,
      { headers: supabaseHeaders }
    );
    const profileRows = profileRes.ok ? await profileRes.json() : [];
    const profile = profileRows?.[0] || null;

    const lastSeen = profile?.last_seen ? new Date(profile.last_seen) : null;

    // Skip if user was active in last 6 hours
    if (lastSeen && lastSeen > sixHoursAgo) {
      skipped++;
      continue;
    }

    // Skip if we already sent a nudge in the last 6 hours
    const lastNudge = profile?.re_engagement_sent_at ? new Date(profile.re_engagement_sent_at) : null;
    if (lastNudge && lastNudge > sixHoursAgo) {
      skipped++;
      continue;
    }

    // Fetch planner data to decide if there's something worth nudging about
    const plannerRes = await fetch(
      `${SUPABASE_URL}/rest/v1/planner_data?user_id=eq.${sub.user_id}&select=data`,
      { headers: supabaseHeaders }
    );

    let plannerData = null;
    if (plannerRes.ok) {
      const rows = await plannerRes.json();
      plannerData = rows?.[0]?.data || null;
    }

    if (!plannerData) { skipped++; continue; }

    // Decide if there's something worth saying
    const nudgeMsg = decideNudge(plannerData);
    if (!nudgeMsg) { skipped++; continue; }

    // Send push
    const result = await sendPush(sub, {
      title: nudgeMsg.title,
      body: nudgeMsg.body,
      tag: 'coach-nudge',
      url: 'https://sea-dashboard.netlify.app/'
    });

    if (result.ok) {
      sent++;
      // Update re_engagement_sent_at so we don't double-nudge within 6 hours
      await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${sub.user_id}`,
        {
          method: 'PATCH',
          headers: supabaseHeaders,
          body: JSON.stringify({ re_engagement_sent_at: now.toISOString() }),
        }
      );
    } else if (result.gone) {
      expired.push(sub.id);
    } else {
      errors++;
    }
  }

  // Clean up expired subscriptions
  if (expired.length > 0) {
    const ids = expired.map(id => `"${id}"`).join(',');
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${ids})`,
      { method: 'DELETE', headers: supabaseHeaders }
    );
  }

  console.log(`coach-nudge-push: checked=${checked}, sent=${sent}, skipped=${skipped}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ checked, sent, skipped, errors, expired: expired.length }) };
};

// Decide if there's something worth nudging about — returns {title, body} or null
function decideNudge(plannerData) {
  const weeks = plannerData.weeks || [];
  const anvilLog = plannerData.anvilProject?.log || [];
  const goals = (plannerData.goals || []).filter(g => g.title?.trim());
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  // Compute anvil streak
  const uniqueDays = [...new Set(anvilLog.map(e => {
    const d = new Date(e.date); d.setHours(0,0,0,0); return d.toDateString();
  }))].map(s => new Date(s)).sort((a,b) => b - a);
  let anvilStreak = 0;
  for (let i = 0; i < uniqueDays.length; i++) {
    const exp = new Date(today); exp.setDate(today.getDate() - i);
    if (uniqueDays[i].toDateString() === exp.toDateString()) anvilStreak++;
    else break;
  }

  const anvilToday = anvilLog.some(e => new Date(e.date).toDateString() === today.toDateString());
  const anvilYesterday = anvilLog.some(e => new Date(e.date).toDateString() === yesterday.toDateString());
  const anvilProject = plannerData.anvilProject?.project;

  // Stuck habits (below 50% for 2+ recent weeks)
  const recentWeeks = weeks.slice(-4);
  const habitIssues = {};
  recentWeeks.forEach(w => (w.aActivities || []).forEach(a => {
    if (!a.name?.trim()) return;
    const target = a.targetDays || 7;
    const done = (a.days || []).filter(Boolean).length;
    if (done < target / 2) habitIssues[a.name] = (habitIssues[a.name] || 0) + 1;
  }));
  const stuckHabits = Object.entries(habitIssues).filter(([,c]) => c >= 2).map(([n]) => n);

  // Stagnant goals
  const stuckGoals = goals.filter(g => (g.completion || 0) > 0 && (g.completion || 0) < 100);

  // Priority: broken streak > at-risk streak > stuck habit > stagnant goal
  if (anvilProject && anvilStreak === 0 && anvilLog.length > 3 && !anvilYesterday) {
    return {
      title: 'Streak Alert',
      body: `Your ${anvilProject} streak is broken. Get back on track today.`
    };
  }

  if (anvilStreak >= 7 && !anvilToday) {
    return {
      title: `${anvilStreak}-day streak on the line`,
      body: `Don't let your ${anvilProject} streak end today. Log your session.`
    };
  }

  if (stuckHabits.length > 0) {
    return {
      title: 'Habit pattern noticed',
      body: `"${stuckHabits[0]}" has been low for 2+ weeks. Worth a look.`
    };
  }

  if (stuckGoals.length > 0 && stuckGoals[0].completion < 25) {
    return {
      title: 'Goal needs attention',
      body: `"${stuckGoals[0].title}" is at ${stuckGoals[0].completion}%. What's one action today?`
    };
  }

  // Only nudge if there's a real trigger — no generic messages
  return null;
}
