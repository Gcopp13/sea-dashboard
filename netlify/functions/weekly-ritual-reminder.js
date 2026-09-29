// weekly-ritual-reminder.js — sends the 8 AM Eastern weekly-planning push.
// Cron: 0 12 * * 6,0 (12:00 UTC = 8 AM EDT / 9 AM EST) — fires Saturday AND Sunday,
// and each subscriber only gets it on the ritual day they picked in Settings
// (planner_data.data.ritualDay, 0=Mon…6=Sun, default 6=Sunday).

const { sendPush } = require('./send-push');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

const supabaseHeaders = {
  'apikey': SUPABASE_SERVICE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

exports.handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('weekly-ritual-reminder: missing env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?weekly_ritual=eq.true&select=*`,
    { headers: supabaseHeaders }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('weekly-ritual-reminder fetch error:', text);
    require('./_lib/sentry').captureException(text, { fn: 'weekly-ritual-reminder' });
    return { statusCode: 500, body: JSON.stringify({ error: text }) };
  }

  const allSubs = await res.json();

  if (!allSubs || allSubs.length === 0) {
    console.log('weekly-ritual-reminder: no subscribers');
    return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
  }

  // Keep only the people whose ritual day is today. 12:00 UTC is the same calendar
  // day in US timezones, so getUTCDay is safe here. 0=Mon…6=Sun to match the app.
  const todayIdx = (new Date().getUTCDay() + 6) % 7;
  const subs = [];
  let skipped = 0;
  for (const sub of allSubs) {
    let ritualDay = 6;                                   // default: Sunday
    if (sub.user_id) {
      try {
        const pr = await fetch(
          `${SUPABASE_URL}/rest/v1/planner_data?user_id=eq.${encodeURIComponent(sub.user_id)}&select=data&limit=1`,
          { headers: supabaseHeaders }
        );
        if (pr.ok) {
          const rows = await pr.json();
          const v = parseInt(rows && rows[0] && rows[0].data && rows[0].data.ritualDay);
          if (v >= 0 && v <= 6) ritualDay = v;
        }
      } catch (e) { /* fall back to Sunday */ }
    }
    if (ritualDay === todayIdx) subs.push(sub); else skipped++;
  }

  if (subs.length === 0) {
    console.log(`weekly-ritual-reminder: nobody plans today (skipped ${skipped})`);
    return { statusCode: 200, body: JSON.stringify({ sent: 0, skipped }) };
  }

  const dayName = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][todayIdx];
  const messages = [
    `${dayName}. 15 minutes to design your week. The rest takes care of itself.`,
    "Your week starts now — not Monday. Open the Weekly Ritual.",
    `${dayName} planning time. 15 minutes now determines how the next 7 days go.`,
    "Don't let the week happen to you. Design it. Weekly Ritual is waiting.",
  ];
  const msg = messages[Math.floor(new Date().getTime() / 604800000) % messages.length];

  let sent = 0;
  let errors = 0;
  const expired = [];

  for (const sub of subs) {
    const result = await sendPush(sub, {
      title: 'S.E.A. Weekly Ritual',
      body: msg,
      tag: 'weekly-ritual',
      url: APP_URL + '/'
    });

    if (result.ok) {
      sent++;
    } else if (result.gone) {
      expired.push(sub.id);
    } else {
      errors++;
    }
  }

  if (expired.length > 0) {
    const ids = expired.map(id => `"${id}"`).join(',');
    await fetch(
      `${SUPABASE_URL}/rest/v1/push_subscriptions?id=in.(${ids})`,
      { method: 'DELETE', headers: supabaseHeaders }
    );
    console.log(`weekly-ritual-reminder: removed ${expired.length} expired subscriptions`);
  }

  console.log(`weekly-ritual-reminder: sent=${sent}, errors=${errors}, expired=${expired.length}, skipped=${skipped}`);
  return { statusCode: 200, body: JSON.stringify({ sent, errors, expired: expired.length, skipped }) };
};
