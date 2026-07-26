// ---------------------------------------------------------------------------
// Server-side error reporting → Sentry (zero-dependency).
//
// Mirrors the fire-and-forget, never-throw contract of _lib/track.js. Instead
// of pulling in @sentry/node (heavy, OpenTelemetry auto-instrumentation, added
// cold-start weight), this posts a minimal Sentry "envelope" directly to the
// ingest endpoint with native fetch — consistent with how the rest of these
// functions talk to external APIs.
//
// Usage from a Netlify function catch block:
//   const { captureException } = require('./_lib/sentry');
//   ...
//   } catch (err) {
//     console.error('[my-fn] error:', err);
//     captureException(err, { fn: 'my-fn', profile_id });   // do NOT await
//     return { statusCode: 500, ... };
//   }
//
// Gated on SENTRY_DSN — if unset, every call is a no-op (safe in local/dev).
// Never throws into caller logic; reporting failures are swallowed.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const DSN = process.env.SENTRY_DSN;
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'production';
const RELEASE = process.env.SENTRY_RELEASE || process.env.COMMIT_REF || undefined;

// Parse a DSN of the form:  https://<publicKey>@<host>/<projectId>
function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !u.host || !projectId) return null;
    return {
      publicKey: u.username,
      host: u.host,
      projectId,
      envelopeUrl: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
    };
  } catch {
    return null;
  }
}

const PARSED = DSN ? parseDsn(DSN) : null;

// Lightweight Node stack-trace parser → Sentry frames (best-effort).
// Sentry expects frames oldest-first, so we reverse the top-down JS stack.
function parseStackFrames(stack) {
  if (!stack || typeof stack !== 'string') return [];
  const lines = stack.split('\n').slice(1); // drop the "Error: message" line
  const frames = [];
  for (const line of lines) {
    // "    at fnName (/path/file.js:12:34)"  or  "    at /path/file.js:12:34"
    let m = line.match(/^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/);
    if (!m) m = line.match(/^\s*at\s+(.+?):(\d+):(\d+)\s*$/);
    if (!m) continue;
    if (m.length === 5) {
      frames.push({ function: m[1], filename: m[2], lineno: +m[3], colno: +m[4], in_app: !m[2].includes('node_modules') });
    } else {
      frames.push({ filename: m[1], lineno: +m[2], colno: +m[3], in_app: !m[1].includes('node_modules') });
    }
  }
  return frames.reverse();
}

/**
 * Report an error to Sentry. Fire-and-forget; do not await on hot paths.
 * @param {Error|any} err     The thrown value.
 * @param {object} context    { fn, ...extra } — `fn` becomes a searchable tag,
 *                             everything else lands in `extra`.
 */
function captureException(err, context = {}) {
  if (!PARSED) return; // DSN unset or malformed → no-op

  try {
    const { fn, ...extra } = context || {};
    const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));

    const eventId = crypto.randomUUID().replace(/-/g, '');
    const nowSec = Date.now() / 1000;
    const nowIso = new Date().toISOString();

    const event = {
      event_id: eventId,
      timestamp: nowSec,
      platform: 'node',
      level: 'error',
      environment: ENVIRONMENT,
      release: RELEASE,
      server_name: fn ? `netlify-fn:${fn}` : 'netlify-fn',
      tags: fn ? { fn } : {},
      extra,
      exception: {
        values: [
          {
            type: error.name || 'Error',
            value: error.message || String(err),
            stacktrace: { frames: parseStackFrames(error.stack) },
          },
        ],
      },
    };

    const body =
      JSON.stringify({ event_id: eventId, sent_at: nowIso, dsn: DSN }) +
      '\n' +
      JSON.stringify({ type: 'event' }) +
      '\n' +
      JSON.stringify(event) +
      '\n';

    // Fire-and-forget. Swallow any transport error.
    fetch(PARSED.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${PARSED.publicKey}, sentry_client=sea-dashboard-fn/1.0`,
      },
      body,
    }).catch(() => {});
  } catch {
    // Never let reporting break the caller.
  }
}

module.exports = { captureException };
