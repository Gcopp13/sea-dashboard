// cycle-recap-email.js — 120-day cycle recap email, sent when a user chooses "Start Fresh".
//
// The client posts { email, name, stats, reflection } where `stats` is already computed
// client-side (streak, sessions, weeks planned, avg score, top wins, goals). This function
// asks Edge (Anthropic) to write a short warm recap narrative, falls back to a stats-only
// email if that call fails, and sends it via Resend — same sender/pattern as welcome-email.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ask Edge for a short, specific, warm recap. Returns '' on any failure (stats-only fallback).
async function buildNarrative(stats, name) {
  if (!ANTHROPIC_API_KEY) return '';
  const firstName = name ? name.split(' ')[0] : 'there';
  const facts = [
    `Name: ${firstName}`,
    `Anvil (daily practice): ${stats.anvilProject || 'their daily practice'}`,
    `Anvil streak: ${stats.streak} days`,
    `Anvil sessions this cycle: ${stats.sessions}`,
    `Weeks planned: ${stats.weeksPlanned} of ${stats.cycleWeeks || 17}`,
    `Average S.E.A. score: ${stats.avgScore}`,
    `Top wins: ${(stats.topWins || []).filter(Boolean).join('; ') || 'none recorded'}`,
    `Goals they set: ${(stats.goals || []).filter(Boolean).join('; ') || 'none'}`,
  ].join('\n');
  const system = `You are Edge, the AI coach inside the S.E.A. Dashboard, writing a short recap email to a financial advisor who just completed a 120-day cycle. Voice: warm, direct, specific, quietly proud of them — Gino's voice. Write 3-4 short sentences of flowing prose (no lists, no headers, no greeting line). Reference their actual numbers and one or two real wins by name. End on momentum for the next 120 days. Never invent facts beyond what you are given.`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        thinking: { type: 'disabled' },
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: `Here are their 120 days:\n${facts}\n\nWrite the recap.` }],
      }),
    });
    if (!res.ok) { console.error('recap narrative: anthropic error', await res.text()); return ''; }
    const data = await res.json();
    return (data.content && data.content[0] && data.content[0].text) ? data.content[0].text.trim() : '';
  } catch (e) {
    console.error('recap narrative failed:', e);
    return '';
  }
}

function buildRecapEmail(stats, name, narrative) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const statCell = (label, value) => `<td align="center" style="padding:12px 8px;">
      <div style="font-size:26px;font-weight:800;color:#1e3a5f;">${esc(value)}</div>
      <div style="font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;color:#64748b;margin-top:2px;">${esc(label)}</div>
    </td>`;
  const wins = (stats.topWins || []).filter(Boolean);
  const winsHtml = wins.length ? `
      <tr><td style="padding:8px 40px 0;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#64748b;">Wins from these 120 days</p>
        ${wins.map(w => `<p style="margin:0 0 6px;font-size:15px;color:#334155;">✅ ${esc(w)}</p>`).join('')}
      </td></tr>` : '';
  const narrativeHtml = narrative ? `
      <tr><td style="padding:26px 40px 8px;">
        <p style="margin:0;font-size:16px;line-height:1.65;color:#1e293b;">${esc(narrative).replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>')}</p>
      </td></tr>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Your 120 Days</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr><td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:36px 40px 28px;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.7);">120 Days Complete</p>
        <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Nice work, ${esc(firstName)} 🎉</h1>
      </td></tr>
      ${narrativeHtml}
      <tr><td style="padding:20px 30px 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;"><tr>
          ${statCell('Streak', (stats.streak || 0) + 'd')}
          ${statCell('Sessions', stats.sessions || 0)}
          ${statCell('Weeks', stats.weeksPlanned || 0)}
          ${statCell('Avg score', stats.avgScore || 0)}
        </tr></table>
      </td></tr>
      ${winsHtml}
      <tr><td style="padding:26px 40px 36px;">
        <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 28px;border-radius:12px;">Start your next 120 days →</a>
        <p style="margin:16px 0 0;font-size:13px;color:#94a3b8;line-height:1.5;">Your streak carries forward — keep piling grains of sand. The cascade is inevitable.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { email, name, stats } = JSON.parse(event.body || '{}');
    if (!email || !stats) {
      return { statusCode: 400, body: JSON.stringify({ error: 'email and stats required' }) };
    }
    if (!RESEND_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Email not configured' }) };
    }

    const narrative = await buildNarrative(stats, name);
    const html = buildRecapEmail(stats, name, narrative);
    const firstName = name ? name.split(' ')[0] : 'there';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Gino from S.E.A. Dashboard <gino.coppola@gettingresultsinc.com>',
        to: [email],
        reply_to: 'gino.coppola@gettingresultsinc.com',
        subject: `${firstName}, your 120 days — the recap`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('cycle-recap-email Resend error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send email', detail: err }) };
    }

    const data = await res.json();
    console.log('Cycle recap email sent to', email, '— id:', data.id, '— narrative:', narrative ? 'yes' : 'stats-only');
    return { statusCode: 200, body: JSON.stringify({ success: true, id: data.id, narrative: !!narrative }) };
  } catch (e) {
    console.error('cycle-recap-email error:', e);
    try { require('./_lib/sentry').captureException(e, { fn: 'cycle-recap-email' }); } catch (_) {}
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
