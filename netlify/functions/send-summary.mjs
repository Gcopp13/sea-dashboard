// netlify/functions/send-summary.mjs
// S.E.A. Dashboard — Weekly Email Summary via Resend

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

  const { email, name, plannerData } = body;
  if (!email?.includes("@")) return new Response(JSON.stringify({ error: "Valid email required" }), { status: 400, headers: CORS });

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || "S.E.A. Dashboard <onboarding@resend.dev>";

  if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500, headers: CORS });

  try {
    const score = calcScore(plannerData || {});
    const html = buildEmail(name || "", plannerData || {}, score);
    const subject = score.total >= 80
      ? `🔥 Outstanding Week — ${score.total} pts · S.E.A. Summary`
      : `📊 Your Weekly S.E.A. Summary — ${score.total} pts`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html }),
    });

    if (!res.ok) throw new Error(await res.text());
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: "/api/send-summary" };

// ── Score calculator (mirrors app logic) ──────────────────────────────────────
function calcScore(data) {
  const weeks = data.weeks || [];
  const weeksWithData = weeks.filter(w => w.wins?.some(x => x.trim()) || w.focus?.trim());
  const week = weeksWithData.length > 0 ? weeksWithData[weeksWithData.length - 1] : (weeks[0] || {});
  const acts = (week.aActivities || []).filter(a => a.name?.trim());
  const habitPct = acts.length > 0 ? acts.reduce((s, a) => s + (a.days || []).filter(Boolean).length, 0) / (acts.length * 7) : 0;
  const anvilLog = data.anvilProject?.log || [];
  let streak = 0;
  if (anvilLog.length) {
    const now = new Date(); now.setHours(0,0,0,0);
    const unique = [...new Set(anvilLog.map(e => { const d = new Date(e.date); d.setHours(0,0,0,0); return d.toDateString(); }))].map(s => new Date(s)).sort((a,b) => b-a);
    for (let i = 0; i < unique.length; i++) { const exp = new Date(now); exp.setDate(now.getDate()-i); if (unique[i].toDateString()===exp.toDateString()) streak++; else break; }
  }
  const wheel = [...weeks].reverse().find(w => w.wheelOfJohn && Object.values(w.wheelOfJohn).some(v => v !== 5))?.wheelOfJohn || {};
  const wheelAvg = Object.keys(wheel).length ? (Object.values(wheel).reduce((s,v)=>s+v,0)/5).toFixed(1) : "5.0";
  const goals = (data.goals || []).filter(g => g.title?.trim());
  const goalAvg = goals.length ? Math.round(goals.reduce((s,g)=>s+(g.completion||0),0)/goals.length) : 0;
  const ritualDone = weeksWithData.length > 0;
  const habitScore = Math.round(habitPct * 30);
  const anvilScore = Math.round(Math.min(streak/30,1)*25);
  const wheelScore = Math.round((parseFloat(wheelAvg)/10)*20);
  const ritualScore = ritualDone ? 15 : 0;
  const goalScore = Math.round(goalAvg * 0.1);
  const total = Math.min(100, habitScore + anvilScore + wheelScore + ritualScore + goalScore);
  return { total, habitPct: Math.round(habitPct*100), anvilStreak: streak, wheelAvg, goalAvg, ritualDone, week, goals };
}

// ── Email HTML builder ────────────────────────────────────────────────────────
function buildEmail(name, data, score) {
  const firstName = name?.split(" ")[0] || "Advisor";
  const scoreColor = score.total >= 80 ? "#22c55e" : score.total >= 60 ? "#f59e0b" : "#ef4444";
  const stars = "⭐".repeat(score.total >= 80 ? 5 : score.total >= 60 ? 4 : score.total >= 40 ? 3 : 2);
  const weekDate = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const wins = (score.week?.wins || []).filter(w => w.trim());
  const goalRows = score.goals.map(g => `
    <tr>
      <td style="padding:6px 0;font-size:14px;color:#e2e8f0;">${g.title}</td>
      <td style="padding:6px 0;text-align:right;font-weight:700;color:${g.completion>=75?"#22c55e":g.completion>=50?"#f59e0b":"#94a3b8"};">${g.completion||0}%</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 16px;">

  <!-- Header -->
  <div style="text-align:center;margin-bottom:32px;">
    <p style="color:#60a5fa;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;">Getting Results Inc.</p>
    <h1 style="color:#f8fafc;font-size:28px;font-weight:900;margin:0 0 4px;">S.E.A. Dashboard</h1>
    <p style="color:#64748b;font-size:14px;margin:0;">Weekly Summary · ${weekDate}</p>
  </div>

  <!-- Score Card -->
  <div style="background:linear-gradient(135deg,#1e1b4b,#0f172a);border:1px solid rgba(99,102,241,0.4);border-radius:20px;padding:32px;text-align:center;margin-bottom:20px;">
    <p style="color:#94a3b8;font-size:14px;margin:0 0 8px;">Hey ${firstName} — here's your week</p>
    <div style="font-size:36px;margin-bottom:8px;">${stars}</div>
    <div style="font-size:72px;font-weight:900;color:${scoreColor};line-height:1;margin-bottom:4px;">${score.total}</div>
    <p style="color:#94a3b8;font-size:14px;margin:0;">out of 100</p>
  </div>

  <!-- Stats Row -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
    <div style="background:#1e293b;border-radius:14px;padding:16px;text-align:center;border:1px solid #334155;">
      <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 6px;">Anvil Streak</p>
      <p style="font-size:32px;margin:0;">🔥</p>
      <p style="color:#f97316;font-size:24px;font-weight:900;margin:4px 0 0;">${score.anvilStreak} days</p>
    </div>
    <div style="background:#1e293b;border-radius:14px;padding:16px;text-align:center;border:1px solid #334155;">
      <p style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 6px;">Habit Rate</p>
      <p style="font-size:32px;margin:0;">✅</p>
      <p style="color:#f59e0b;font-size:24px;font-weight:900;margin:4px 0 0;">${score.habitPct}%</p>
    </div>
  </div>

  <!-- Wins -->
  ${wins.length > 0 ? `
  <div style="background:#1e293b;border-radius:14px;padding:20px;margin-bottom:20px;border:1px solid #334155;">
    <p style="color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">✓ This Week's Wins</p>
    ${wins.map(w => `<p style="color:#e2e8f0;font-size:14px;margin:0 0 8px;padding-left:12px;border-left:3px solid #22c55e;">${w}</p>`).join("")}
  </div>` : ""}

  <!-- Goals -->
  ${score.goals.length > 0 ? `
  <div style="background:#1e293b;border-radius:14px;padding:20px;margin-bottom:20px;border:1px solid #334155;">
    <p style="color:#f97316;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 12px;">🎯 Goal Progress</p>
    <table style="width:100%;border-collapse:collapse;">${goalRows}</table>
  </div>` : ""}

  <!-- CTA -->
  <div style="text-align:center;margin-bottom:32px;">
    <a href="https://sea-dashboardindex18.netlify.app" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;text-decoration:none;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;">
      Open My S.E.A. Dashboard →
    </a>
  </div>

  <!-- Footer -->
  <div style="text-align:center;border-top:1px solid #1e293b;padding-top:20px;">
    <p style="color:#475569;font-size:12px;margin:0;">Getting Results Inc. · S.E.A. Dashboard</p>
    <p style="color:#334155;font-size:11px;margin:4px 0 0;">You're receiving this because you opted in to weekly summaries.</p>
  </div>

</div>
</body></html>`;
}
