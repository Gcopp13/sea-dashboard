// save-push-subscription.js — saves or updates a user's push subscription
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  const { userId, subscription, preferences } = body;
  if (!userId || !subscription?.endpoint) return { statusCode: 400, body: 'Missing userId or subscription' };

  const record = {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh || '',
    auth: subscription.keys?.auth || '',
    evening_reminder: preferences?.eveningReminder ?? true,
    evening_time: preferences?.eveningTime || '19:00',
    weekly_ritual: preferences?.weeklyRitual ?? true,
    coach_nudge: preferences?.coachNudge ?? true,
    timezone: preferences?.timezone || 'America/New_York',
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(record, { onConflict: 'user_id,endpoint' });

  if (error) {
    console.error('save-push-subscription error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
