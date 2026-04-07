// netlify/functions/coach.mjs
import { getStore } from "@netlify/blobs";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ok  = (data)      => new Response(JSON.stringify(data), { status: 200, headers: CORS });
const err = (msg, code) => new Response(JSON.stringify({ error: msg }), { status: code || 400, headers: CORS });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  const advisorStore = getStore("sea-advisors");
  const messageStore = getStore("sea-messages");

  // ── POST ?action=share ─────────────────────────────────────────────────────
  // Advisor pushes their snapshot so the coach can see them.
  if (action === "share" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return err("Invalid JSON"); }
    if (!body?.advisorId || !body?.coachId) return err("Missing advisorId or coachId");

    const key = `${body.coachId}__${body.advisorId}`;
    const record = {
      advisorId:   body.advisorId,
      coachId:     body.coachId,
      advisorData: body.advisorData || {},
      lastUpdated: Date.now(),
    };
    await advisorStore.setJSON(key, record);
    return ok({ success: true });
  }

  // ── GET ?action=get-advisors&coachId=XXX ───────────────────────────────────
  // Coach fetches all advisors linked to their ID.
  if (action === "get-advisors" && req.method === "GET") {
    const coachId = url.searchParams.get("coachId");
    if (!coachId) return err("Missing coachId");

    const { blobs } = await advisorStore.list({ prefix: `${coachId}__` });

    const advisors = await Promise.all(
      blobs.map(async (blob) => {
        const result = await advisorStore.get(blob.key, { type: "json" });
        return result;
      })
    );

    const valid = advisors.filter(Boolean).sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0));
    return ok(valid);
  }

  // ── POST ?action=send-message ──────────────────────────────────────────────
  // Coach sends a message to a specific advisor.
  if (action === "send-message" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return err("Invalid JSON"); }
    if (!body?.advisorId || !body?.message) return err("Missing advisorId or message");

    const key      = `msg__${body.advisorId}`;
    const existing = (await messageStore.get(key, { type: "json" })) || [];

    existing.push({
      id:        crypto.randomUUID(),
      coachId:   body.coachId   || "coach",
      coachName: body.coachName || "Your Coach",
      message:   body.message,
      timestamp: Date.now(),
      read:      false,
    });

    await messageStore.setJSON(key, existing.slice(-50));
    return ok({ success: true });
  }

  // ── GET ?action=get-messages&advisorId=XXX ─────────────────────────────────
  // Advisor polls for messages from their coach.
  if (action === "get-messages" && req.method === "GET") {
    const advisorId = url.searchParams.get("advisorId");
    if (!advisorId) return err("Missing advisorId");

    const messages = (await messageStore.get(`msg__${advisorId}`, { type: "json" })) || [];
    return ok(messages);
  }

  // ── POST ?action=mark-read ─────────────────────────────────────────────────
  // Mark all messages as read for an advisor.
  if (action === "mark-read" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return err("Invalid JSON"); }
    if (!body?.advisorId) return err("Missing advisorId");

    const key      = `msg__${body.advisorId}`;
    const messages = (await messageStore.get(key, { type: "json" })) || [];
    await messageStore.setJSON(key, messages.map(m => ({ ...m, read: true })));
    return ok({ success: true });
  }

  return err("Unknown action", 404);
};

export const config = { path: "/api/coach" };
