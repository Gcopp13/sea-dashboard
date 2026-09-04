// morning-reminder.js — sends a 7 AM Eastern daily push to all subscribed users.
// Cron: 0 11 * * * (11:00 UTC = 7 AM EDT / 6 AM EST). Mirrors evening-reminder.js.
// Tapping it deep-links straight into the Edge morning kickoff.

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
    console.error('morning-reminder: missing env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  // Get all subscriptions with morning_reminder enabled
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?morning_reminder=eq.true&select=*`,
    { headers: supabaseHeaders }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('morning-reminder fetch error:', text);
    require('./_lib/sentry').captureException(text, { fn: 'morning-reminder' });
    return { statusCode: 500, body: JSON.stringify({ error: text }) };
  }

  const subs = await res.json();

  if (!subs || subs.length === 0) {
    console.log('morning-reminder: no subscribers');
    return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
  }

  const messages = [
    "Good morning. Lock in your ONE focus for today — 30 seconds with Edge.",
    "New day. What's the one thing that has to happen today? Set it now.",
    "Before the day runs you — pick your #1 and commit. Let's go.",
    "Morning. Your Top 3 are waiting. Which one matters most today?",
    "Start on purpose. 30 seconds to name today's priority.",
  ];
  const msg = messages[new Date().getDate() % messages.length];

  let sent = 0;
  let errors = 0;
  const expired = [];

  for (const sub of subs) {
    const result = await sendPush(sub, {
      title: 'S.E.A. Morning Kickoff',
      body: msg,
      tag: 'morning-kickoff',
      url: APP_URL + '/?tab=today&section=morning'   // opens the Edge morning kickoff directly
    });

    if (result.ok) {
      sent++;
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
    console.log(`morning-reminder: removed ${expired.length} expired subscriptions`);
  }

  console.log(`morning-reminder: sent=${sent}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ sent, errors, expired: expired.length }) };
};
