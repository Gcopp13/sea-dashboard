// evening-reminder.js — sends 7 PM Eastern daily push to all subscribed users
// Cron: 0 23 * * * (23:00 UTC = 7 PM EDT / 8 PM EST — uses Eastern offset dynamically)

const { createClient } = require('@supabase/supabase-js');
const { sendPush } = require('./send-push');

exports.handler = async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Get all subscriptions with evening_reminder enabled
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('evening_reminder', true);

  if (error) {
    console.error('evening-reminder fetch error:', error);
    return { statusCode: 500, body: error.message };
  }

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

  // Clean up expired subscriptions
  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired);
    console.log(`evening-reminder: removed ${expired.length} expired subscriptions`);
  }

  console.log(`evening-reminder: sent=${sent}, errors=${errors}, expired=${expired.length}`);
  return { statusCode: 200, body: JSON.stringify({ sent, errors, expired: expired.length }) };
};
