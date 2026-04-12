/**
 * send-summary.js — Weekly S.E.A. summary email via Resend
 *
 * Accepts POST with { email, name, plannerData }
 * Sends a nicely formatted HTML email from noreply@gettingresultsinc.com
 * using the Resend API (RESEND_API_KEY env var).
 */

const { Resend } = require('resend');

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
    body: JSON.stringify({ error: message, success: false }),
  };
}

// ── Helper: derive summary data from plannerData ─────────────────────────────
function buildSummaryData(plannerData) {
  const data = plannerData || {};

  // Get the most recent week with data
  const weeks = Array.isArray(data.weeks) ? data.weeks : [];
  const recentWeek = weeks.find((w) => w && (w.wins?.some((x) => x?.trim()) || w.focus?.trim())) || null;

  // Compute S.E.A. score from most recent week if available
  let seaScore = null;
  if (recentWeek) {
    const checkIns = Array.isArray(recentWeek.checkIns) ? recentWeek.checkIns : [];
    const completed = checkIns.filter((c) => c?.completed).length;
    const total = checkIns.length;
    if (total > 0) {
      seaScore = Math.round((completed / total) * 100);
    }
  }

  // Wins
  const wins = recentWeek?.wins?.filter((w) => w?.trim()) || [];

  // Anvil streak
  const anvilProject = data.anvilProject || {};
  const anvilLog = Array.isArray(anvilProject.log) ? anvilProject.log : [];
  let anvilStreak = 0;
  if (anvilLog.length > 0) {
    const today = new Date();
    const sortedLog = [...anvilLog].sort((a, b) => new Date(b.date) - new Date(a.date));
    for (let i = 0; i < sortedLog.length; i++) {
      const logDate = new Date(sortedLog[i].date);
      const diffDays = Math.round((today - logDate) / (1000 * 60 * 60 * 24));
      if (diffDays <= i + 1) {
        anvilStreak++;
      } else {
        break;
      }
    }
  }

  // Slight edges
  const slightEdge = data.slightEdge || '';

  // Goals progress
  const goals = (data.goals || []).filter((g) => g?.title?.trim());

  return {
    seaScore,
    wins,
    anvilStreak,
    anvilProject: anvilProject.project || '',
    slightEdge,
    goals,
    weekFocus: recentWeek?.focus || '',
    yearTheme: data.yearTheme || '',
  };
}

// ── HTML email template ───────────────────────────────────────────────────────
function buildEmailHtml(name, summary) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const { seaScore, wins, anvilStreak, anvilProject, slightEdge, goals, weekFocus, yearTheme } = summary;

  const scoreColor = seaScore === null ? '#94a3b8' : seaScore >= 80 ? '#22c55e' : seaScore >= 60 ? '#eab308' : '#ef4444';
  const scoreDisplay = seaScore !== null ? `${seaScore}%` : 'Not yet calculated';

  const winsHtml =
    wins.length > 0
      ? wins.map((w) => `<li style="margin-bottom:6px;color:#e2e8f0;">${escapeHtml(w)}</li>`).join('')
      : '<li style="color:#94a3b8;font-style:italic;">No wins recorded this week yet</li>';

  const goalsHtml =
    goals.length > 0
      ? goals
          .map(
            (g) => `
          <div style="padding:10px 14px;background:#1e293b;border-radius:8px;margin-bottom:8px;border-left:3px solid #6366f1;">
            <span style="color:#e2e8f0;font-size:14px;">${escapeHtml(g.title)}</span>
          </div>`
          )
          .join('')
      : '<p style="color:#94a3b8;font-style:italic;font-size:14px;">No goals set yet</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Your S.E.A. Weekly Summary</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af,#7c3aed);border-radius:16px 16px 0 0;padding:32px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">S.E.A. Dashboard</div>
              <div style="font-size:14px;color:#bfdbfe;margin-top:4px;">Slight Edge Accelerator</div>
              <div style="font-size:13px;color:#93c5fd;margin-top:2px;">Weekly Summary</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#1e293b;padding:32px;border-radius:0 0 16px 16px;">

              <!-- Greeting -->
              <p style="font-size:20px;font-weight:700;color:#f1f5f9;margin:0 0 8px;">Hey ${escapeHtml(firstName)},</p>
              <p style="font-size:15px;color:#94a3b8;margin:0 0 28px;line-height:1.6;">
                Here's your weekly snapshot. Small edges compounded over time — that's the game.
              </p>

              ${yearTheme ? `
              <!-- Year Theme -->
              <div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;text-align:center;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:4px;">Year Theme</div>
                <div style="font-size:18px;font-weight:700;color:#818cf8;">${escapeHtml(yearTheme)}</div>
              </div>` : ''}

              <!-- S.E.A. Score -->
              <div style="background:#0f172a;border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #334155;text-align:center;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px;">This Week's S.E.A. Score</div>
                <div style="font-size:48px;font-weight:800;color:${scoreColor};">${scoreDisplay}</div>
                ${seaScore !== null ? `<div style="font-size:13px;color:#64748b;margin-top:4px;">Check-ins completed</div>` : ''}
              </div>

              <!-- Wins -->
              <div style="margin-bottom:20px;">
                <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;margin-bottom:12px;">Top Wins This Week</div>
                <ul style="margin:0;padding:0 0 0 18px;list-style:disc;">
                  ${winsHtml}
                </ul>
              </div>

              ${weekFocus ? `
              <!-- Week Focus -->
              <div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Week Focus</div>
                <div style="font-size:14px;color:#e2e8f0;line-height:1.5;">${escapeHtml(weekFocus)}</div>
              </div>` : ''}

              <!-- Anvil Streak -->
              <div style="background:#0f172a;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #334155;display:flex;align-items:center;">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:4px;">Anvil Streak${anvilProject ? ` — ${escapeHtml(anvilProject)}` : ''}</div>
                      <div style="font-size:32px;font-weight:800;color:#f59e0b;">${anvilStreak} day${anvilStreak !== 1 ? 's' : ''}</div>
                    </td>
                    <td align="right" style="font-size:36px;">🔨</td>
                  </tr>
                </table>
              </div>

              <!-- Goals -->
              <div style="margin-bottom:20px;">
                <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:600;margin-bottom:12px;">Your 120-Day Goals</div>
                ${goalsHtml}
              </div>

              ${slightEdge ? `
              <!-- Slight Edges -->
              <div style="background:#0f172a;border-radius:12px;padding:16px 20px;margin-bottom:20px;border:1px solid #334155;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:6px;">Your Slight Edges</div>
                <div style="font-size:13px;color:#cbd5e1;line-height:1.6;">${escapeHtml(slightEdge)}</div>
              </div>` : ''}

              <!-- CTA -->
              <div style="text-align:center;margin-top:28px;">
                <a href="${process.env.APP_URL || 'https://sea-dashboard.netlify.app'}"
                   style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#7c3aed);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700;font-size:15px;">
                  Open My Dashboard →
                </a>
              </div>

              <!-- Footer -->
              <div style="margin-top:32px;padding-top:20px;border-top:1px solid #334155;text-align:center;">
                <p style="font-size:12px;color:#475569;margin:0;">
                  S.E.A. Dashboard by Getting Results Inc.<br/>
                  <span style="font-size:11px;color:#334155;">You're receiving this because you opted in to weekly summaries.</span>
                </p>
              </div>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Simple HTML entity escaping to prevent injection in email
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

  const { email, name, plannerData } = body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return err('A valid email address is required', 400);
  }

  // Validate env
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('[send-summary] RESEND_API_KEY environment variable is not set');
    return err('Server configuration error: Email service is not configured', 503);
  }

  try {
    const resend = new Resend(resendKey);
    const summary = buildSummaryData(plannerData);
    const html = buildEmailHtml(name || '', summary);

    const firstName = name ? name.split(' ')[0] : 'there';
    const scoreText = summary.seaScore !== null ? ` — ${summary.seaScore}% this week` : '';

    const result = await resend.emails.send({
      from: 'S.E.A. Dashboard <noreply@gettingresultsinc.com>',
      to: [email.trim()],
      subject: `Your S.E.A. Weekly Summary${scoreText}`,
      html,
    });

    if (result.error) {
      console.error('[send-summary] Resend error:', result.error);
      return err(result.error.message || 'Failed to send email', 502);
    }

    return ok({ success: true, id: result.data?.id });
  } catch (e) {
    console.error('[send-summary] Unhandled error:', e);
    return err(e.message || 'Failed to send email');
  }
};
