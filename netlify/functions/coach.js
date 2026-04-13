/**
 * coach.js — Main backend API for S.E.A. Dashboard
 * Uses Supabase REST API directly via fetch (no npm dependencies needed).
 *
 * Actions (via ?action= query param):
 *   POST  ?action=share              — Upsert advisor scores
 *   GET   ?action=get-advisors       — List all advisors for a coach
 *   POST  ?action=send-message       — Send coach message to advisor
 *   GET   ?action=get-messages       — Get messages for an advisor (both directions)
 *   POST  ?action=mark-read          — Mark messages as read (advisor side)
 *   POST  ?action=send-reply         — Advisor sends message to coach
 *   GET   ?action=get-coach-inbox    — Coach reads all messages from advisors
 *   POST  ?action=mark-coach-read    — Coach marks advisor messages as read
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

function err(message, statusCode = 500) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ error: message }) };
}

// Supabase REST helper
async function supabase(method, table, { query = '', body = null } = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { data, status: res.status, ok: res.ok };
}

// POST ?action=share
async function handleShare(body) {
  const { advisorId, coachId, advisorData } = body;
  if (!advisorId || !coachId) return err('advisorId and coachId are required', 400);

  // Try PATCH first, fall back to POST
  const patch = await supabase('PATCH', 'advisor_scores', {
    query: `?advisor_id=eq.${advisorId}&coach_id=eq.${coachId}`,
    body: { advisor_data: advisorData, last_updated: new Date().toISOString() },
  });

  if (patch.status === 204 || patch.ok) return ok({ success: true });

  // No row — insert
  const { data, ok: success, status } = await supabase('POST', 'advisor_scores', {
    body: {
      advisor_id: advisorId,
      coach_id: coachId,
      advisor_data: advisorData,
      last_updated: new Date().toISOString(),
    },
  });

  if (!success) {
    console.error('[share] error:', data);
    return err(data?.message || 'Failed to save score', status);
  }
  return ok({ success: true });
}

// GET ?action=get-advisors&coachId=
async function handleGetAdvisors(params) {
  const coachId = params.coachId;
  if (!coachId) return err('coachId is required', 400);

  const { data, ok: success, status } = await supabase('GET', 'advisor_scores', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&order=last_updated.desc`,
  });

  if (!success) {
    console.error('[get-advisors] error:', data);
    return err(data?.message || 'Failed to load advisors', status);
  }

  // For each advisor, attach unread reply count from coach inbox
  const advisors = data || [];
  const inboxRes = await supabase('GET', 'coach_messages', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&sender=eq.advisor&read=eq.false&select=advisor_id`,
  });
  const unreadMap = {};
  if (inboxRes.ok && Array.isArray(inboxRes.data)) {
    inboxRes.data.forEach(m => {
      unreadMap[m.advisor_id] = (unreadMap[m.advisor_id] || 0) + 1;
    });
  }
  return ok(advisors.map(a => ({ ...a, unreadReplies: unreadMap[a.advisor_id] || 0 })));
}

// POST ?action=send-message  (coach → advisor)
async function handleSendMessage(body) {
  const { coachId, coachName, advisorId, advisorName, message } = body;
  if (!coachId || !advisorId || !message) return err('coachId, advisorId, and message are required', 400);

  const { data, ok: success, status } = await supabase('POST', 'coach_messages', {
    body: {
      coach_id: coachId,
      coach_name: coachName || 'Your Coach',
      advisor_id: advisorId,
      advisor_name: advisorName || '',
      message,
      sender: 'coach',
      read: false,
      timestamp: new Date().toISOString(),
    },
  });

  if (!success) {
    console.error('[send-message] error:', data);
    return err(data?.message || 'Failed to send message', status);
  }
  return ok({ success: true });
}

// POST ?action=send-reply  (advisor → coach)
async function handleSendReply(body) {
  const { coachId, advisorId, advisorName, message } = body;
  if (!coachId || !advisorId || !message) return err('coachId, advisorId, and message are required', 400);

  const { data, ok: success, status } = await supabase('POST', 'coach_messages', {
    body: {
      coach_id: coachId,
      coach_name: '',
      advisor_id: advisorId,
      advisor_name: advisorName || 'Advisor',
      message,
      sender: 'advisor',
      read: false,
      timestamp: new Date().toISOString(),
    },
  });

  if (!success) {
    console.error('[send-reply] error:', data);
    return err(data?.message || 'Failed to send reply', status);
  }
  return ok({ success: true });
}

// GET ?action=get-messages&advisorId=  (all messages for this advisor, both directions)
async function handleGetMessages(params) {
  const advisorId = params.advisorId;
  if (!advisorId) return err('advisorId is required', 400);

  const { data, ok: success, status } = await supabase('GET', 'coach_messages', {
    query: `?advisor_id=eq.${encodeURIComponent(advisorId)}&order=timestamp.asc`,
  });

  if (!success) {
    console.error('[get-messages] error:', data);
    return err(data?.message || 'Failed to load messages', status);
  }
  return ok(data || []);
}

// GET ?action=get-coach-inbox&coachId=  (all advisor replies, for coach view)
async function handleGetCoachInbox(params) {
  const coachId = params.coachId;
  if (!coachId) return err('coachId is required', 400);

  const { data, ok: success, status } = await supabase('GET', 'coach_messages', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&sender=eq.advisor&order=timestamp.desc`,
  });

  if (!success) {
    console.error('[get-coach-inbox] error:', data);
    return err(data?.message || 'Failed to load inbox', status);
  }
  return ok(data || []);
}

// POST ?action=mark-read  (advisor marks coach messages as read)
async function handleMarkRead(body) {
  const { advisorId } = body;
  if (!advisorId) return err('advisorId is required', 400);

  const { ok: success, status, data } = await supabase('PATCH', 'coach_messages', {
    query: `?advisor_id=eq.${encodeURIComponent(advisorId)}&sender=eq.coach&read=eq.false`,
    body: { read: true },
  });

  if (!success) {
    console.error('[mark-read] error:', data);
    return err(data?.message || 'Failed to mark read', status);
  }
  return ok({ success: true });
}

// POST ?action=mark-coach-read  (coach marks advisor replies as read)
async function handleMarkCoachRead(body) {
  const { coachId, advisorId } = body;
  if (!coachId || !advisorId) return err('coachId and advisorId are required', 400);

  const { ok: success, status, data } = await supabase('PATCH', 'coach_messages', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&advisor_id=eq.${encodeURIComponent(advisorId)}&sender=eq.advisor&read=eq.false`,
    body: { read: true },
  });

  if (!success) {
    console.error('[mark-coach-read] error:', data);
    return err(data?.message || 'Failed to mark read', status);
  }
  return ok({ success: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const action = event.queryStringParameters?.action;
  const method = event.httpMethod;

  let body = {};
  if (method === 'POST' && event.body) {
    try { body = JSON.parse(event.body); } catch { return err('Invalid JSON', 400); }
  }

  try {
    switch (action) {
      case 'share':            return method === 'POST' ? await handleShare(body) : err('Method not allowed', 405);
      case 'get-advisors':     return method === 'GET'  ? await handleGetAdvisors(event.queryStringParameters || {}) : err('Method not allowed', 405);
      case 'send-message':     return method === 'POST' ? await handleSendMessage(body) : err('Method not allowed', 405);
      case 'send-reply':       return method === 'POST' ? await handleSendReply(body) : err('Method not allowed', 405);
      case 'get-messages':     return method === 'GET'  ? await handleGetMessages(event.queryStringParameters || {}) : err('Method not allowed', 405);
      case 'get-coach-inbox':  return method === 'GET'  ? await handleGetCoachInbox(event.queryStringParameters || {}) : err('Method not allowed', 405);
      case 'mark-read':        return method === 'POST' ? await handleMarkRead(body) : err('Method not allowed', 405);
      case 'mark-coach-read':  return method === 'POST' ? await handleMarkCoachRead(body) : err('Method not allowed', 405);
      default:                 return err(`Unknown action: ${action || '(none)'}`, 400);
    }
  } catch (e) {
    console.error('[coach] unhandled error:', e);
    return err(e.message || 'Internal server error');
  }
};
