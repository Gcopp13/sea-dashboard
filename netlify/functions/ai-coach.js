/**
 * ai-coach.js — Anthropic Claude API proxy for S.E.A. Dashboard
 *
 * Accepts POST with { messages, systemPrompt, maxTokens }
 * Calls Claude claude-sonnet-4-20250514 server-side using ANTHROPIC_API_KEY env var.
 * Returns { content: [{ text: "..." }] } — same shape the client expects.
 *
 * This function keeps the API key off the browser entirely.
 */

const Anthropic = require('@anthropic-ai/sdk');

// ── CORS headers ─────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Response helpers ─────────────────────────────────────────────────────────
function ok(data) {
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

function err(message, statusCode = 500) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return err('Method not allowed — use POST', 405);
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return err('Invalid JSON body', 400);
  }

  const { messages, systemPrompt, maxTokens } = body;

  // Validate required fields
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return err('messages array is required and must not be empty', 400);
  }

  // Validate env
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[ai-coach] ANTHROPIC_API_KEY environment variable is not set');
    return err('Server configuration error: AI service is not configured', 503);
  }

  // Sanitize messages — only pass role/content, strip anything else
  const sanitizedMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(({ role, content }) => ({ role, content }));

  if (sanitizedMessages.length === 0) {
    return err('No valid messages found after sanitization', 400);
  }

  try {
    const client = new Anthropic({ apiKey });

    const requestParams = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens || 1024,
      messages: sanitizedMessages,
    };

    if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim()) {
      requestParams.system = systemPrompt.trim();
    }

    const response = await client.messages.create(requestParams);

    // Return in the same shape the front-end expects
    return ok({
      content: response.content,
      model: response.model,
      stop_reason: response.stop_reason,
      usage: response.usage,
    });
  } catch (e) {
    console.error('[ai-coach] Anthropic API error:', e);

    // Surface Anthropic API errors clearly
    if (e.status) {
      return err(`Anthropic API error ${e.status}: ${e.message}`, e.status >= 500 ? 502 : 400);
    }

    return err(e.message || 'Failed to call AI service');
  }
};
