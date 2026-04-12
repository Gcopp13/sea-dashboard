/**
 * coach.js — Main backend API for S.E.A. Dashboard
 * Handles advisor data sharing, messaging, and read receipts via Supabase.
 *
 * Actions (via ?action= query param):
 *   POST  ?action=share         — Upsert advisor scores
 *   GET   ?action=get-advisors  — List all advisors for a coach
 *   POST  ?action=send-message  — Send coach message to advisor
 *   GET   ?action=get-messages  — Get messages for an advisor
 *   POST  ?action=mark-read     — Mark messages as read
 */

const { createClient } = require('@supabase/supabase-js');

// ── CORS headers ────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Supabase client (uses service role key — never exposed to browser) ──────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required');
  }
  return createClient(url, key);
}

// ── Response helpers ─────────────────────────────────────────────────────────
function ok(data, statusCode = 200) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function err(message, statusCode = 500) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

// ── Action handlers ──────────────────────────────────────────────────────────

/**
 * POST ?action=share
 * Body: { advisorId, coachId, advisorData }
 * Upserts advisor scores into the `advisor_scores` table.
 */
async function handleShare(body) {
  const { advisorId, coachId, advisorData } = body;

  if (!advisorId || !coachId) {
    return err('advisorId and coachId are required', 400);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('advisor_scores')
    .upsert(
      {
        advisor_id: advisorId,
        coach_id: coachId,
        advisor_data: advisorData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'advisor_id' }
    )
    .select()
    .single();

  if (error) {
    console.error('[coach] share error:', error);
    return err(error.message);
  }

  return ok({ success: true, data });
}

/**
 * GET ?action=get-advisors&coachId=<id>
 * Returns all advisor records for the given coach.
 */
async function handleGetAdvisors(queryParams) {
  const coachId = queryParams.coachId;

  if (!coachId) {
    return err('coachId query parameter is required', 400);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('advisor_scores')
    .select('*')
    .eq('coach_id', coachId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[coach] get-advisors error:', error);
    return err(error.message);
  }

  return ok({ advisors: data || [] });
}

/**
 * POST ?action=send-message
 * Body: { coachId, coachName, advisorId, message }
 * Inserts a new message into the `coach_messages` table.
 */
async function handleSendMessage(body) {
  const { coachId, coachName, advisorId, message } = body;

  if (!coachId || !advisorId || !message) {
    return err('coachId, advisorId, and message are required', 400);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('coach_messages')
    .insert({
      coach_id: coachId,
      coach_name: coachName || '',
      advisor_id: advisorId,
      message,
      read: false,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('[coach] send-message error:', error);
    return err(error.message);
  }

  return ok({ success: true, data });
}

/**
 * GET ?action=get-messages&advisorId=<id>
 * Returns all messages for the given advisor, ordered oldest first.
 */
async function handleGetMessages(queryParams) {
  const advisorId = queryParams.advisorId;

  if (!advisorId) {
    return err('advisorId query parameter is required', 400);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('coach_messages')
    .select('*')
    .eq('advisor_id', advisorId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[coach] get-messages error:', error);
    return err(error.message);
  }

  return ok({ messages: data || [] });
}

/**
 * POST ?action=mark-read
 * Body: { advisorId }
 * Marks all unread messages for the advisor as read.
 */
async function handleMarkRead(body) {
  const { advisorId } = body;

  if (!advisorId) {
    return err('advisorId is required', 400);
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from('coach_messages')
    .update({ read: true })
    .eq('advisor_id', advisorId)
    .eq('read', false);

  if (error) {
    console.error('[coach] mark-read error:', error);
    return err(error.message);
  }

  return ok({ success: true });
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const action = event.queryStringParameters?.action;
  const method = event.httpMethod;

  let body = {};
  if (method === 'POST' && event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return err('Invalid JSON body', 400);
    }
  }

  try {
    switch (action) {
      case 'share':
        if (method !== 'POST') return err('Method not allowed', 405);
        return await handleShare(body);

      case 'get-advisors':
        if (method !== 'GET') return err('Method not allowed', 405);
        return await handleGetAdvisors(event.queryStringParameters || {});

      case 'send-message':
        if (method !== 'POST') return err('Method not allowed', 405);
        return await handleSendMessage(body);

      case 'get-messages':
        if (method !== 'GET') return err('Method not allowed', 405);
        return await handleGetMessages(event.queryStringParameters || {});

      case 'mark-read':
        if (method !== 'POST') return err('Method not allowed', 405);
        return await handleMarkRead(body);

      default:
        return err(`Unknown action: ${action || '(none)'}`, 400);
    }
  } catch (e) {
    console.error('[coach] Unhandled error:', e);
    return err(e.message || 'Internal server error');
  }
};
