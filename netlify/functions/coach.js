/**
 * coach.js — Main backend API for S.E.A. Dashboard
 * Uses Supabase REST API directly via fetch (no npm dependencies needed).
 *
 * Actions (via ?action= query param):
 *   POST  ?action=share              — Upsert advisor scores
 *   GET   ?action=get-advisors       — List all advisors for a coach
 *   POST  ?action=send-message       — Send coach message to advisor
 *   POST  ?action=send-nudge         — Coach sends push notification + saves message
 *   GET   ?action=get-messages       — Get messages for an advisor (both directions)
 *   POST  ?action=mark-read          — Mark messages as read (advisor side)
 *   POST  ?action=send-reply         — Advisor sends message to coach
 *   GET   ?action=get-coach-inbox    — Coach reads all messages from advisors
 *   POST  ?action=mark-coach-read    — Coach marks advisor messages as read
 *   GET   ?action=resolve-code       — Look up coach by their coach_code
 *   POST  ?action=notify-coach-connected — Notify coach via push + email when user connects
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

  // Pull all clients assigned to this coach from profiles
  const profilesRes = await supabase('GET', 'profiles', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&select=id,full_name,email`,
  });
  if (!profilesRes.ok) {
    console.error('[get-advisors] profiles error:', profilesRes.data);
    return err(profilesRes.data?.message || 'Failed to load advisors', profilesRes.status);
  }
  const clients = profilesRes.data || [];

  // Pull any existing advisor_scores rows for richer data
  const scoresRes = await supabase('GET', 'advisor_scores', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&select=advisor_id,advisor_data,last_updated`,
  });
  const scoresMap = {};
  if (scoresRes.ok && Array.isArray(scoresRes.data)) {
    scoresRes.data.forEach(row => { scoresMap[row.advisor_id] = row; });
  }

  // Unread message counts
  const inboxRes = await supabase('GET', 'coach_messages', {
    query: `?coach_id=eq.${encodeURIComponent(coachId)}&sender=eq.advisor&read=eq.false&select=advisor_id`,
  });
  const unreadMap = {};
  if (inboxRes.ok && Array.isArray(inboxRes.data)) {
    inboxRes.data.forEach(m => { unreadMap[m.advisor_id] = (unreadMap[m.advisor_id] || 0) + 1; });
  }

  // Merge
  const advisors = clients.map(client => {
    const scoreRow = scoresMap[client.id];
    const advisorData = scoreRow?.advisor_data || scoreRow?.advisorData || {};
    if (!advisorData.n && !advisorData.name) {
      advisorData.n = client.full_name || client.email || 'Unnamed Advisor';
    }
    return {
      advisorId: client.id,
      advisor_id: client.id,
      advisorData,
      lastUpdated: scoreRow?.last_updated || null,
      unreadReplies: unreadMap[client.id] || 0,
    };
  });

  advisors.sort((a, b) => {
    if (a.lastUpdated && b.lastUpdated) return new Date(b.lastUpdated) - new Date(a.lastUpdated);
    if (a.lastUpdated) return -1;
    if (b.lastUpdated) return 1;
    return 0;
  });

  return ok(advisors);
}

// POST ?action=send-message  (coach -> advisor, no push)
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

// POST ?action=send-nudge  (coach -> advisor with push notification)
async function handleSendNudge(body) {
  const { coachId, advisorId, message } = body;
  if (!coachId || !advisorId || !message) return err('coachId, advisorId, and message are required', 400);

  // Verify sender is a coach or admin
  const coachRes = await supabase('GET', 'profiles', {
    query: `?id=eq.${encodeURIComponent(coachId)}&select=full_name,email,role`,
  });
  if (!coachRes.ok || !coachRes.data?.[0]) return err('Coach not found', 404);
  const coach = coachRes.data[0];
  if (!['coach', 'admin'].includes(coach.role)) return err('Unauthorized', 403);
  const coachName = coach.full_name || coach.email || 'Your Coach';

  // Save message to coach_messages
  const msgRes = await supabase('POST', 'coach_messages', {
    body: {
      coach_id: coachId,
      coach_name: coachName,
      advisor_id: advisorId,
      message,
      sender: 'coach',
      read: false,
      timestamp: new Date().toISOString(),
    },
  });
  if (!msgRes.ok) {
    console.error('[send-nudge] message save error:', msgRes.data);
    return err('Failed to save message', 500);
  }

  // Look up push subscription (flat columns: endpoint, p256dh, auth)
  const subRes = await supabase('GET', 'push_subscriptions', {
    query: `?user_id=eq.${encodeURIComponent(advisorId)}&select=endpoint,p256dh,auth&limit=1`,
  });

  let pushSent = false;
  if (subRes.ok && subRes.data?.[0]?.endpoint) {
    const sub = subRes.data[0];
    try {
      const { sendPush } = require('./send-push');
      const result = await sendPush(sub, {
        title: 'Coach message for you',
        body: message.length > 120 ? message.substring(0, 117) + '...' : message,
        tag: 'coach-nudge',
        url: '/?tab=more&section=messages',
      });
      pushSent = result.ok;
      if (!result.ok) console.warn('[send-nudge] push not delivered:', result.error);
    } catch (e) {
      console.warn('[send-nudge] push error:', e.message);
    }
  }

  return ok({ success: true, messageSaved: true, pushSent });
}

// POST ?action=send-reply  (advisor -> coach)
async function handleSendReply(body) {
  const { coachId, advisorId, advisorName, message } = body;
  if (!coachId || !advisorId || !message) return err('coachId, advisorId, and message are required', 400);

  // Look up the advisor's real name from profiles
  let displayName = advisorName || 'Advisor';
  try {
    const profileRes = await supabase('GET', 'profiles', {
      query: `?id=eq.${encodeURIComponent(advisorId)}&select=full_name,email`,
    });
    if (profileRes.ok && profileRes.data?.[0]) {
      const p = profileRes.data[0];
      displayName = p.full_name || p.email || advisorName || 'Advisor';
    }
  } catch(e) { /* use fallback */ }

  const { data, ok: success, status } = await supabase('POST', 'coach_messages', {
    body: {
      coach_id: coachId,
      coach_name: '',
      advisor_id: advisorId,
      advisor_name: displayName,
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

  // Push notify the coach
  try {
    const subRes = await supabase('GET', 'push_subscriptions', {
      query: `?user_id=eq.${encodeURIComponent(coachId)}&select=endpoint,p256dh,auth&limit=1`,
    });
    if (subRes.ok && subRes.data?.[0]?.endpoint) {
      const { sendPush } = require('./send-push');
      await sendPush(subRes.data[0], {
        title: `Message from ${displayName}`,
        body: message.length > 120 ? message.substring(0, 117) + '...' : message,
        tag: 'advisor-reply',
        url: '/?tab=coach',
      });
    }
  } catch(e) {
    console.warn('[send-reply] push error:', e.message);
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

  const messages = data || [];

  // Enrich advisor_name — look up any messages that have a missing/generic name
  const genericIds = [...new Set(
    messages
      .filter(m => !m.advisor_name || m.advisor_name === 'Advisor')
      .map(m => m.advisor_id)
  )];

  const nameMap = {};
  for (const id of genericIds) {
    try {
      const res = await supabase('GET', 'profiles', {
        query: `?id=eq.${encodeURIComponent(id)}&select=full_name,email`,
      });
      if (res.ok && res.data?.[0]) {
        const p = res.data[0];
        nameMap[id] = p.full_name || p.email || 'Advisor';
      }
    } catch(e) { /* skip */ }
  }

  const enriched = messages.map(m =>
    (!m.advisor_name || m.advisor_name === 'Advisor') && nameMap[m.advisor_id]
      ? { ...m, advisor_name: nameMap[m.advisor_id] }
      : m
  );

  return ok(enriched);
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

// GET ?action=resolve-code&code=XXXX  — look up coach by coach_code
async function handleResolveCode(params) {
  const code = (params.code || '').trim().toUpperCase();
  if (!code) return err('code is required', 400);

  const { data, ok: success } = await supabase('GET', 'profiles', {
    query: `?coach_code=eq.${encodeURIComponent(code)}&select=id,full_name,email,role`,
  });

  if (!success || !data || data.length === 0) {
    return err('Invalid coach code. Please check with your coach and try again.', 404);
  }

  const coach = data[0];
  if (!['coach', 'admin'].includes(coach.role)) {
    return err('That code does not belong to a coach account.', 403);
  }

  return ok({
    coachId: coach.id,
    coachName: coach.full_name || coach.email || 'Your Coach',
  });
}


// POST ?action=notify-coach-connected — fires when a user connects to a coach
// Sends the coach a push notification + email
async function handleNotifyCoachConnected(body) {
  const { coachId, advisorId, advisorName, advisorEmail } = body;
  if (!coachId || !advisorId) return err('coachId and advisorId are required', 400);

  // Get coach details
  const coachRes = await supabase('GET', 'profiles', {
    query: `?id=eq.${encodeURIComponent(coachId)}&select=full_name,email,role`,
  });
  if (!coachRes.ok || !coachRes.data?.[0]) return err('Coach not found', 404);
  const coach = coachRes.data[0];
  if (!['coach', 'admin'].includes(coach.role)) return err('Unauthorized', 403);

  const displayName = advisorName || advisorEmail || 'A new user';
  let pushSent = false;
  let emailSent = false;

  // 1. Push notification to coach
  const subRes = await supabase('GET', 'push_subscriptions', {
    query: `?user_id=eq.${encodeURIComponent(coachId)}&select=endpoint,p256dh,auth&limit=1`,
  });
  if (subRes.ok && subRes.data?.[0]?.endpoint) {
    try {
      const { sendPush } = require('./send-push');
      const result = await sendPush(subRes.data[0], {
        title: 'New coach connection',
        body: `${displayName} just connected to you as their coach.`,
        tag: 'coach-connection',
        url: '/?tab=coach',
      });
      pushSent = result.ok;
    } catch (e) {
      console.warn('[notify-coach-connected] push error:', e.message);
    }
  }

  // 2. Email to coach via Resend
  if (coach.email) {
    try {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'S.E.A. Dashboard <onboarding@gettingresultsinc.com>',
          to: [coach.email],
          subject: `${displayName} connected to you on S.E.A. Dashboard`,
          html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0f172a;">
    <tr><td align="center" style="padding:48px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <!-- Header -->
        <tr><td align="center" style="padding-bottom:28px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:14px;padding:10px 18px;">
            <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-0.5px;">S.E.A.</span>
            <span style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.75);display:block;letter-spacing:0.5px;">SLIGHT EDGE ACCELERATOR</span>
          </div>
          <p style="margin:10px 0 0;font-size:11px;color:#475569;letter-spacing:1px;text-transform:uppercase;font-weight:600;">Getting Results Inc.</p>
        </td></tr>
        <!-- Card -->
        <tr><td style="background:#1e293b;border-radius:20px;border:1px solid #334155;overflow:hidden;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="height:4px;background:linear-gradient(90deg,#3b82f6,#8b5cf6,#10b981);"></td></tr>
            <tr><td style="padding:36px 36px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center" style="padding-bottom:20px;">
                  <div style="width:52px;height:52px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;">🤝</div>
                </td></tr>
              </table>
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#f8fafc;text-align:center;">New Connection!</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;text-align:center;line-height:1.6;">
                <strong style="color:#f8fafc;">${displayName}</strong> just connected to you as their coach on the S.E.A. Dashboard.
              </p>
              <div style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:12px;padding:16px 20px;margin-bottom:24px;">
                <p style="margin:0;font-size:13px;color:#6ee7b7;text-align:center;">They can now receive your messages and nudges, and you can see their progress in the Coach tab.</p>
              </div>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center">
                  <a href="${process.env.APP_URL || 'https://sea-dashboard.netlify.app'}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:12px;">
                    Open Coach Dashboard →
                  </a>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 0 0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#334155;">© Getting Results Inc. · S.E.A. Dashboard</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        }),
      });
      emailSent = emailRes.ok;
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.warn('[notify-coach-connected] email error:', errText);
      }
    } catch (e) {
      console.warn('[notify-coach-connected] email error:', e.message);
    }
  }

  return ok({ success: true, pushSent, emailSent });
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
      case 'send-nudge':       return method === 'POST' ? await handleSendNudge(body) : err('Method not allowed', 405);
      case 'send-reply':       return method === 'POST' ? await handleSendReply(body) : err('Method not allowed', 405);
      case 'get-messages':     return method === 'GET'  ? await handleGetMessages(event.queryStringParameters || {}) : err('Method not allowed', 405);
      case 'get-coach-inbox':  return method === 'GET'  ? await handleGetCoachInbox(event.queryStringParameters || {}) : err('Method not allowed', 405);
      case 'mark-read':        return method === 'POST' ? await handleMarkRead(body) : err('Method not allowed', 405);
      case 'mark-coach-read':  return method === 'POST' ? await handleMarkCoachRead(body) : err('Method not allowed', 405);
      case 'resolve-code':     return method === 'GET'  ? await handleResolveCode(event.queryStringParameters || {}) : err('Method not allowed', 405);
      case 'notify-coach-connected': return method === 'POST' ? await handleNotifyCoachConnected(body) : err('Method not allowed', 405);
      default:                 return err(`Unknown action: ${action || '(none)'}`, 400);
    }
  } catch (e) {
    console.error('[coach] unhandled error:', e);
    return err(e.message || 'Internal server error');
  }
};
