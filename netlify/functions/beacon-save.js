/**
 * beacon-save.js — receives sendBeacon payloads on page close
 * and saves to Supabase. sendBeacon sends as text/plain so we
 * parse the body manually. No auth token available on unload,
 * so we use the service key and match by user_id.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };
  }

  try {
    const { user_id, data, updated_at } = JSON.parse(event.body || '{}');
    if (!user_id || !data) {
      return { statusCode: 400, headers: cors, body: 'Missing user_id or data' };
    }

    const now = updated_at || new Date().toISOString();
    const headers = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    };

    // Try PATCH first (update existing row)
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/planner_data?user_id=eq.${user_id}`,
      { method: 'PATCH', headers, body: JSON.stringify({ data, updated_at: now }) }
    );

    // If no row existed, INSERT
    if (patchRes.status === 404 || patchRes.headers.get('content-range') === '*/0') {
      await fetch(`${SUPABASE_URL}/rest/v1/planner_data`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id, data, updated_at: now }),
      });
    }

    return { statusCode: 200, headers: cors, body: 'ok' };
  } catch (e) {
    console.error('[beacon-save] error:', e);
    return { statusCode: 500, headers: cors, body: e.message };
  }
};
