// coach-nudge-push.js — hourly check: push coach nudge if user inactive 6+ hours
// Cron: 0 * * * * (every hour)

const { createClient } = require('@supabase/supabase-js');
const { sendPush } = require('./send-push');

exports.handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Get all coach_nudge subscribers with their profile (for last_seen)
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*, profiles!inner(id, last_seen, email)')
    .eq('coach_nudge', true);

  if (error) {
    console.error('coach-nudge-push fetch error:', error);
    return { statusCode: 500, body: error.message };
  }

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
    const lastSeen = sub.profiles?.last_seen ? new Date(sub.profiles.last_seen) : null;

    // Skip if user was active in last 6 hours
    if (lastSeen && lastSeen > sixHoursAgo) {
      skipped++;
      continue;
    }

    // Check if we already sent a nudge in the last 6 hours (avoid double-nudging)
    const nudgeKey = `coach-nudge-sent-${sub.user_id}`;
    const { data: nudgeRecord } = await supabase
      .from('push_subscriptions')
      .select('updated_at')
      .eq('user_id', sub.user_id)
      .single();

    // Use a simple time-based dedup: tag updated_at when we send a nudge
    // We store last nudge time in a separate lightweight check
    const { data: nudgeLog } = await supabase
      .from('profiles')
      .select('re_engagement_sent_at')
      .eq('id', sub.user_id)
      .single();

    const lastNudge = nudgeLog?.re_engagement_sent_at ? new Date(nudgeLog.re_engagement_sent_at) : null;
    if (lastNudge && lastNudge > sixHoursAgo) {
      skipped++;
      continue;
    }

    // Fetch planner data to run smart trigger logic
    const { data: plannerRow } = await supabase
      .from('planner_data')
      .select('data')
      .eq('user_id', sub.user_id)
      .single();

    const plannerData = plannerRow?.data;
    if (!plannerData) { skipped++; continue; }

    // Decide if there's something worth saying
    const nudgeMsg = await decideNudge(plannerData);
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
      // Update re_engagement_sent_at so we don't double-nudge
      await supabase
        .from('profiles')
        .update({ re_engagement_sent_at: now.toISOString() })
        .eq('id', sub.user_id);
    } else if (result.gone) {
      expired.push(sub.id);
    } else {
      errors++;
    }
  }

  // Clean up expired subscriptions
  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired);
  }

  console.log(`coach-nudge-push: checked=${checked}, sent=${sent}, skipped=${skipped}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ checked, sent, skipped, errors, expired: expired.length }) };
};

// Decide if there's something worth nudging about — returns {title, body} or null
async function decideNudge(plannerData) {
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

  const weeksWithData = weeks.filter(w => w.wins?.some(x => x.trim()) || w.focus?.trim());
  const latestWeek = weeksWithData[weeksWithData.length - 1];

  // Stuck habits
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

  // Last commitment
  const lastCommitment = null; // Can't access localStorage server-side

  // Priority: broken streak > stuck habit > stagnant goal > general nudge
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

  // Only nudge if there was a real trigger — don't send generic ones
  return null;
}
