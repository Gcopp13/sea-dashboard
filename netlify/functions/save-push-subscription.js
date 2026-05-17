// save-push-subscription.js — saves or updates a user's push subscription in Supabase
// Uses native fetch (no Supabase SDK) to avoid WebSocket/ws dependency issues on Node 20

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { userId, subscription, preferences } = body;
  if (!userId || !subscription?.endpoint) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId or subscription endpoint' }) };
  }

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

  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/push_subscriptions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(record),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error('save-push-subscription error:', text);
    return { statusCode: 500, body: JSON.stringify({ error: text }) };
  }

  console.log(`save-push-subscription: saved for user ${userId}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
