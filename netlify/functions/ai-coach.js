/**
 * ai-coach.js — Claude API proxy for S.E.A. Dashboard
 *
 * SECURITY: this endpoint requires a valid Supabase user JWT
 * (Authorization: Bearer <access_token>). Without that check it is an open,
 * unmetered Claude proxy billed to us — the URL is public in the client HTML.
 *
 * Uses native fetch — no npm dependencies needed.
 */

const ALLOWED_ORIGINS = [
  'https://sea-dashboard.netlify.app',
  'https://main--sea-dashboard.netlify.app',
];

// Hard caps so a single authenticated request can't run up a large bill.
const MAX_TOKENS_CAP = 2000;
const MAX_MESSAGES = 60;
const MAX_TOTAL_CHARS = 200000;
const MAX_SYSTEM_PROMPT_CHARS = 20000;

function corsHeaders(origin) {
  // Requests from the app itself are same-origin; the allowlist is defence in
  // depth for browsers. It does NOT stop server-to-server abuse — the JWT check does.
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

/**
 * Verify the caller's Supabase access token against GoTrue.
 * Returns { user } on success, or { error, status } on failure.
 */
async function verifyUser(authHeader) {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Sign in required', status: 401 };

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[ai-coach] SUPABASE_URL / SUPABASE_SERVICE_KEY not configured');
    return { error: 'Auth not configured', status: 500 };
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { error: 'Invalid or expired session', status: 401 };
    const user = await res.json();
    if (!user || !user.id) return { error: 'Invalid or expired session', status: 401 };
    return { user };
  } catch (e) {
    console.error('[ai-coach] token verification failed:', e);
    return { error: 'Could not verify session', status: 503 };
  }
}

exports.handler = async (event) => {
  const headers = corsHeaders(event.headers?.origin || event.headers?.Origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Require an authenticated S.E.A. user ─────────────────────────────────
  const authResult = await verifyUser(event.headers?.authorization || event.headers?.Authorization);
  if (!authResult.user) {
    return {
      statusCode: authResult.status || 401,
      headers,
      body: JSON.stringify({ error: authResult.error || 'Unauthorized' }),
    };
  }
  const user = authResult.user;

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { messages, systemPrompt, maxTokens = 1000 } = payload;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'messages array is required' }) };
  }

  if (messages.length > MAX_MESSAGES) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Too many messages' }) };
  }

  const totalChars =
    (typeof systemPrompt === 'string' ? systemPrompt.length : 0) +
    messages.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return { statusCode: 413, headers, body: JSON.stringify({ error: 'Request too large' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // Clamp caller-supplied values so one request can't request a huge completion.
  const cappedMaxTokens = Math.min(Math.max(parseInt(maxTokens, 10) || 1000, 1), MAX_TOKENS_CAP);
  const system = typeof systemPrompt === 'string' ? systemPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS) : '';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Thinking is ON by default on Sonnet 5, and max_tokens caps thinking +
        // reply together. Disable it so the whole 2000-token budget goes to the
        // coach's reply (matches Sonnet 4.6's prior no-thinking behavior — no truncation).
        thinking: { type: 'disabled' },
        max_tokens: cappedMaxTokens,
        system,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`[ai-coach] Anthropic error (user ${user.id}):`, data);
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    console.error(`[ai-coach] fetch error (user ${user.id}):`, e);
    require('./_lib/sentry').captureException(e, { fn: 'ai-coach' });
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
