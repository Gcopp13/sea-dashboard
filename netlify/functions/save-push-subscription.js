// save-push-subscription.js — saves or updates the CALLER's push subscription.
//
// SECURITY: requires a valid Supabase user JWT (Authorization: Bearer <access_token>).
// The row's user_id is taken from the verified token, never from the request body, so a
// caller can only ever write their own subscription. Previously this trusted a client-
// supplied userId with the service key, letting anyone overwrite anyone's subscription.
//
// Uses native fetch (no Supabase SDK) to avoid ws dependency issues on Node 20.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Verify the caller's Supabase access token against GoTrue. Returns { user } or { error, status }.
async function verifyUser(authHeader) {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Sign in required', status: 401 };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('save-push-subscription: SUPABASE_URL / SUPABASE_SERVICE_KEY not configured');
    return { error: 'Auth not configured', status: 500 };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { error: 'Invalid or expired session', status: 401 };
    const user = await res.json();
    if (!user || !user.id) return { error: 'Invalid or expired session', status: 401 };
    return { user };
  } catch (e) {
    console.error('save-push-subscription: token verification failed:', e);
    return { error: 'Could not verify session', status: 503 };
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const auth = await verifyUser(event.headers?.authorization || event.headers?.Authorization);
  if (!auth.user) {
    return { statusCode: auth.status || 401, body: JSON.stringify({ error: auth.error || 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { subscription, preferences } = body;
  if (!subscription?.endpoint) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing subscription endpoint' }) };
  }

  const record = {
    user_id: auth.user.id, // from the verified token, NOT the request body
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh || '',
    auth: subscription.keys?.auth || '',
    morning_reminder: preferences?.morningReminder ?? true,
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

  console.log(`save-push-subscription: saved for user ${auth.user.id}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
