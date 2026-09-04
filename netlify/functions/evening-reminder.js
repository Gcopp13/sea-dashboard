// evening-reminder.js — sends 7 PM Eastern daily push to all subscribed users
// Cron: 0 23 * * * (23:00 UTC = 7 PM EDT / 8 PM EST)

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
    console.error('evening-reminder: missing env vars');
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  // Get all subscriptions with evening_reminder enabled
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions?evening_reminder=eq.true&select=*`,
    { headers: supabaseHeaders }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('evening-reminder fetch error:', text);
    require('./_lib/sentry').captureException(text, { fn: 'evening-reminder' });
    return { statusCode: 500, body: JSON.stringify({ error: text }) };
  }

  const subs = await res.json();

  if (!subs || subs.length === 0) {
    console.log('evening-reminder: no subscribers');
    return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
  }

  const messages = [
    "Close out your day. One win, one miss, one thing you're carrying into tomorrow.",
    "2 minutes. How did today go? Log it before you lose it.",
    "End of day check-in. Don't skip it — 60 seconds to close the loop.",
    "Day's not done until you reflect. What happened today that's worth keeping?",
    "Quick close-out. Win, miss, carry-forward. Go.",
  ];
  const msg = messages[new Date().getDate() % messages.length];

  let sent = 0;
  let errors = 0;
  const expired = [];

  for (const sub of subs) {
    const result = await sendPush(sub, {
      title: 'S.E.A. Evening Review',
      body: msg,
      tag: 'evening-review',
      url: APP_URL + '/?tab=today&section=evening'   // opens the Edge evening review directly
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
    console.log(`evening-reminder: removed ${expired.length} expired subscriptions`);
  }

  console.log(`evening-reminder: sent=${sent}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ sent, errors, expired: expired.length }) };
};
