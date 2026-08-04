// weekly-ritual-reminder.js — sends 8 AM Eastern Sunday push to all subscribed users
// Cron: 0 12 * * 0 (12:00 UTC = 8 AM EDT / 9 AM EST)

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

  const subs = await res.json();

  if (!subs || subs.length === 0) {
    console.log('weekly-ritual-reminder: no subscribers');
    return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };
  }

  const messages = [
    "Sunday. 15 minutes to design your week. The rest takes care of itself.",
    "Your week starts now — not Monday. Open the Weekly Ritual.",
    "Sunday planning time. 15 minutes now determines how the next 7 days go.",
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

  console.log(`weekly-ritual-reminder: sent=${sent}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ sent, errors, expired: expired.length }) };
};
