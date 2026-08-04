// send-daily-brief.js
// POST — sends the daily brief to the user's registered email
// withPdf=false → plain text email
// withPdf=true  → PDF attachment generated with pdfkit

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'S.E.A. Dashboard <onboarding@gettingresultsinc.com>';
const APP_URL = process.env.APP_URL || 'https://sea-dashboard.netlify.app';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'Bad request' }; }

  const {
    email, weekNum, score, prevScore,
    habitsDone, habitsTarget, habitsCount,
    anvilDone, anvilTarget, anvilProject = '',
    goals = [], withPdf = false,
  } = body;

  if (!email) return { statusCode: 400, body: 'email required' };

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const scoreArrow = prevScore != null ? (score >= prevScore ? '▲' : '▼') : null;
  const scoreCompare = prevScore != null ? ` (${scoreArrow} ${prevScore} last week)` : '';

  // ── Build plain-text content ──────────────────────────────────────────────
  const textLines = [
    `S.E.A. Dashboard — Daily Brief`,
    `${today} · Week ${weekNum}`,
    ``,
    `━━━ SCORE ━━━`,
    `Week-to-date: ${score} pts${scoreCompare}`,
    ``,
    `━━━ HABITS ━━━`,
    habitsCount > 0
      ? `${habitsDone} of ${habitsTarget} days completed so far this week (${habitsCount} habit${habitsCount !== 1 ? 's' : ''} tracked)`
      : `No habits set up yet`,
    ``,
    `━━━ ANVIL: ${anvilProject} ━━━`,
    anvilTarget > 0
      ? `${anvilDone} of ${anvilTarget} scheduled session${anvilTarget !== 1 ? 's' : ''} logged this week`
      : `No sessions scheduled yet`,
    ``,
    `━━━ GOALS IN PROGRESS ━━━`,
    ...(goals.length > 0
      ? goals.map(g => `• ${g.title} — ${g.pct}%`)
      : ['No goals in progress']),
    ``,
    `─────────────────────────`,
    `Log in to S.E.A. Dashboard → ${APP_URL}`,
  ];
  const plainText = textLines.join('\n');

  // ── HTML email body ───────────────────────────────────────────────────────
  const goalsHtml = goals.length > 0
    ? goals.map(g => `
        <tr>
          <td style="padding:6px 0;color:#cbd5e1;font-size:14px;">• ${escHtml(g.title)}</td>
          <td style="padding:6px 0;color:#818cf8;font-size:14px;text-align:right;font-weight:700;">${g.pct}%</td>
        </tr>`).join('')
    : `<tr><td style="color:#64748b;font-size:13px;" colspan="2">No goals in progress</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6366f1;letter-spacing:2px;text-transform:uppercase;">S.E.A. Dashboard</p>
      <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;">Daily Brief</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#64748b;">${today} &nbsp;·&nbsp; Week ${weekNum}</p>
    </div>

    <!-- Score card -->
    <div style="background:linear-gradient(135deg,rgba(99,102,241,0.25),rgba(139,92,246,0.18));border:1px solid rgba(99,102,241,0.35);border-radius:16px;padding:20px 24px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Score Week-to-Date</p>
        <p style="margin:0;font-size:40px;font-weight:900;color:#ffffff;">${score}<span style="font-size:16px;color:#94a3b8;font-weight:400;"> pts</span></p>
      </div>
      ${prevScore != null ? `
      <div style="text-align:right;">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;">Last Week</p>
        <p style="margin:0;font-size:20px;font-weight:700;color:${score >= prevScore ? '#34d399' : '#f87171'};">${scoreArrow} ${prevScore} pts</p>
      </div>` : ''}
    </div>

    <!-- Habits -->
    <div style="background:#1e293b;border-radius:14px;padding:16px 20px;margin-bottom:12px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">💪 Habits</p>
      <p style="margin:0;font-size:15px;color:#e2e8f0;">
        ${habitsCount > 0
          ? `<strong style="color:#fff;">${habitsDone}</strong> of <strong style="color:#fff;">${habitsTarget}</strong> days completed so far this week`
          : '<span style="color:#64748b;">No habits set up yet</span>'}
      </p>
    </div>

    <!-- Anvil -->
    <div style="background:#1e293b;border-radius:14px;padding:16px 20px;margin-bottom:12px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">⚒️ ${escHtml(anvilProject)}</p>
      <p style="margin:0;font-size:15px;color:#e2e8f0;">
        ${anvilTarget > 0
          ? `<strong style="color:#fff;">${anvilDone}</strong> of <strong style="color:#fff;">${anvilTarget}</strong> scheduled session${anvilTarget !== 1 ? 's' : ''} logged this week`
          : '<span style="color:#64748b;">No sessions scheduled yet</span>'}
      </p>
    </div>

    <!-- Goals -->
    <div style="background:#1e293b;border-radius:14px;padding:16px 20px;margin-bottom:28px;">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">🎯 Goals In Progress</p>
      <table style="width:100%;border-collapse:collapse;">${goalsHtml}</table>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:32px;">
      <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:50px;">Open Dashboard →</a>
    </div>

    <p style="margin:0;font-size:11px;color:#334155;text-align:center;">S.E.A. Dashboard &nbsp;·&nbsp; Getting Results Inc.</p>
  </div>
</body>
</html>`;

  // ── Send plain text email ─────────────────────────────────────────────────
  if (!withPdf) {
    const res = await sendEmail({ to: email, subject: `Daily Brief — Week ${weekNum} · ${score} pts`, html, text: plainText });
    if (!res.ok) return { statusCode: 500, body: JSON.stringify({ error: 'Email failed', detail: res.body }) };
    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  }

  // ── Generate PDF and attach ───────────────────────────────────────────────
  try {
    const PDFDocument = require('pdfkit');
    const chunks = [];
    const pdfDoc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `S.E.A. Daily Brief — Week ${weekNum}` } });
    pdfDoc.on('data', c => chunks.push(c));
    await new Promise((resolve, reject) => {
      pdfDoc.on('end', resolve);
      pdfDoc.on('error', reject);

      // Background
      pdfDoc.rect(0, 0, 612, 792).fill('#0f172a');

      // Header bar
      pdfDoc.rect(50, 50, 512, 4).fill('#6366f1');

      // Title
      pdfDoc.moveDown(0.3);
      pdfDoc.fillColor('#6366f1').fontSize(10).font('Helvetica-Bold')
        .text('S.E.A. DASHBOARD  ·  DAILY BRIEF', 50, 65, { letterSpacing: 2 });
      pdfDoc.fillColor('#ffffff').fontSize(26).font('Helvetica-Bold')
        .text(`Week ${weekNum}  ·  ${score} pts`, 50, 82);
      pdfDoc.fillColor('#64748b').fontSize(11).font('Helvetica')
        .text(today, 50, 114);

      // Score box
      pdfDoc.roundedRect(50, 135, 512, 64, 10).fill('#1e293b');
      pdfDoc.fillColor('#94a3b8').fontSize(9).font('Helvetica-Bold')
        .text('SCORE WEEK-TO-DATE', 70, 148);
      pdfDoc.fillColor('#ffffff').fontSize(28).font('Helvetica-Bold')
        .text(`${score} pts`, 70, 160);
      if (prevScore != null) {
        const arrow = score >= prevScore ? '▲' : '▼';
        const clr = score >= prevScore ? '#34d399' : '#f87171';
        pdfDoc.fillColor(clr).fontSize(14).font('Helvetica-Bold')
          .text(`${arrow} ${prevScore} pts last week`, 350, 165, { align: 'right', width: 200 });
      }

      let y = 220;
      const section = (icon, label, value) => {
        pdfDoc.roundedRect(50, y, 512, 54, 8).fill('#1e293b');
        pdfDoc.fillColor('#94a3b8').fontSize(9).font('Helvetica-Bold').text(`${icon}  ${label}`, 70, y + 10);
        pdfDoc.fillColor('#e2e8f0').fontSize(13).font('Helvetica').text(value, 70, y + 25, { width: 472 });
        y += 66;
      };

      section('💪', 'HABITS',
        habitsCount > 0
          ? `${habitsDone} of ${habitsTarget} days completed so far this week`
          : 'No habits set up yet');

      section('⚒️', (anvilProject || 'Anvil').toUpperCase(),
        anvilTarget > 0
          ? `${anvilDone} of ${anvilTarget} scheduled session${anvilTarget !== 1 ? 's' : ''} logged this week`
          : 'No sessions scheduled yet');

      // Goals section
      const goalsHeight = Math.max(54, 44 + goals.length * 20);
      pdfDoc.roundedRect(50, y, 512, goalsHeight, 8).fill('#1e293b');
      pdfDoc.fillColor('#94a3b8').fontSize(9).font('Helvetica-Bold').text('🎯  GOALS IN PROGRESS', 70, y + 10);
      if (goals.length === 0) {
        pdfDoc.fillColor('#64748b').fontSize(12).font('Helvetica').text('No goals in progress', 70, y + 28);
      } else {
        goals.forEach((g, i) => {
          pdfDoc.fillColor('#cbd5e1').fontSize(12).font('Helvetica')
            .text(`• ${g.title}`, 70, y + 26 + i * 20, { width: 380, continued: false });
          pdfDoc.fillColor('#818cf8').fontSize(12).font('Helvetica-Bold')
            .text(`${g.pct}%`, 440, y + 26 + i * 20, { align: 'right', width: 110 });
        });
      }
      y += goalsHeight + 24;

      // Footer
      pdfDoc.rect(50, 748, 512, 1).fill('#1e293b');
      pdfDoc.fillColor('#334155').fontSize(9).font('Helvetica')
        .text('S.E.A. Dashboard  ·  Getting Results Inc.  ·  ' + APP_URL, 50, 756, { align: 'center', width: 512 });

      pdfDoc.end();
    });

    const pdfBase64 = Buffer.concat(chunks).toString('base64');
    const filename = `SEA-Daily-Brief-Week${weekNum}.pdf`;

    const res = await sendEmail({
      to: email,
      subject: `Daily Brief — Week ${weekNum} · ${score} pts`,
      html,
      text: plainText,
      attachments: [{ filename, content: pdfBase64, type: 'application/pdf', disposition: 'attachment' }],
    });
    if (!res.ok) return { statusCode: 500, body: JSON.stringify({ error: 'Email failed', detail: res.body }) };
    return { statusCode: 200, body: JSON.stringify({ sent: true, pdf: true }) };
  } catch (e) {
    console.error('[send-daily-brief] PDF error:', e.message);
    require('./_lib/sentry').captureException(e, { fn: 'send-daily-brief' });
    // Fall back to plain email if PDF generation fails
    const res = await sendEmail({ to: email, subject: `Daily Brief — Week ${weekNum} · ${score} pts`, html, text: plainText });
    return { statusCode: 200, body: JSON.stringify({ sent: true, pdf: false, pdfError: e.message }) };
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text, attachments }) {
  const payload = { from: FROM_EMAIL, to, subject, html, text };
  if (attachments?.length) payload.attachments = attachments;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: r.ok, body: await r.text() };
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
