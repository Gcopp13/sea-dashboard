// weekly-ritual-reminder.js — sends 8 AM Eastern Sunday push to all subscribed users
// Cron: 0 12 * * 0 (12:00 UTC = 8 AM EDT / 9 AM EST — uses Eastern offset dynamically)

const { createClient } = require('@supabase/supabase-js');
const { sendPush } = require('./send-push');

exports.handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('weekly_ritual', true);

  if (error) {
    console.error('weekly-ritual-reminder fetch error:', error);
    return { statusCode: 500, body: error.message };
  }

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
      url: 'https://sea-dashboard.netlify.app/'
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
    await supabase.from('push_subscriptions').delete().in('id', expired);
    console.log(`weekly-ritual-reminder: removed ${expired.length} expired subscriptions`);
  }

  console.log(`weekly-ritual-reminder: sent=${sent}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ sent, errors, expired: expired.length }) };
};
