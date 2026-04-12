/**
 * ai-coach.js — Secure Claude API proxy for S.E.A. Dashboard
 * Uses native fetch — no npm dependencies needed.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { messages, systemPrompt, maxTokens = 1000 } = payload;

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'messages array is required' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemPrompt || '',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[ai-coach] Anthropic error:', data);
      return { statusCode: res.status, headers: CORS_HEADERS, body: JSON.stringify({ error: data.error?.message || 'Anthropic API error' }) };
    }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
  } catch (e) {
    console.error('[ai-coach] fetch error:', e);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};
