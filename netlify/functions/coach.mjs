// netlify/functions/coach.mjs
// S.E.A. Dashboard — Coach Communication Layer
// Handles: advisor share-to-coach, coach fetch advisors, coach send message, advisor fetch messages

import { getStore } from "@netlify/blobs";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ok = (data) => new Response(JSON.stringify(data), { headers: CORS });
const err = (msg, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: CORS });

export default async (req) => {
  // Preflight
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const advisorStore = getStore("sea-advisors");
  const messageStore = getStore("sea-messages");

  // ─────────────────────────────────────────────
  // POST /api/coach?action=share
  // Advisor pushes their snapshot to Blobs so coach can see them.
  // Body: { advisorId, coachId, advisorData: { name, score, streak, goals, habits } }
  // ─────────────────────────────────────────────
  if (action === "share" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.advisorId || !body?.coachId) return err("Missing advisorId or coachId");

    const record = {
      advisorId: body.advisorId,
      coachId:   body.coachId,
      advisorData: body.advisorData || {},
      lastUpdated: Date.now(),
    };

    const key = `coach:${body.coachId}:advisor:${body.advisorId}`;
    await advisorStore.set(key, JSON.stringify(record));
    return ok({ success: true });
  }

  // ─────────────────────────────────────────────
  // GET /api/coach?action=get-advisors&coachId=XXX
  // Coach fetches all advisors linked to their ID.
  // ─────────────────────────────────────────────
  if (action === "get-advisors" && req.method === "GET") {
    const coachId = url.searchParams.get("coachId");
    if (!coachId) return err("Missing coachId");

    const { blobs } = await advisorStore.list({ prefix: `coach:${coachId}:advisor:` });

    const advisors = await Promise.all(
      blobs.map(async (blob) => {
        try {
          return await advisorStore.get(blob.key, { type: "json" });
        } catch {
          return null;
        }
      })
    );

    return ok(advisors.filter(Boolean));
  }

  // ─────────────────────────────────────────────
  // POST /api/coach?action=send-message
  // Coach sends a message to a specific advisor.
  // Body: { advisorId, coachId, coachName, message }
  // ─────────────────────────────────────────────
  if (action === "send-message" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body?.advisorId || !body?.message) return err("Missing advisorId or message");

    const key = `messages:${body.advisorId}`;
    const existing = (await messageStore.get(key, { type: "json" }).catch(() => null)) || [];

    existing.push({
      id:        crypto.randomUUID(),
      coachId:   body.coachId   || "coach",
      coachName: body.coachName || "Your Coach",
      message:   body.message,
      timestamp: Date.now(),
      read:      false,
    });

    // Keep last 50 messages
    const trimmed = existing.slice(-50);
    await messageStore.set(key, JSON.stringify(trimmed));
    return ok({ success: true });
  }

  // ─────────────────────────────────────────────
  // GET /api/coach?action=get-messages&advisorId=XXX
  // Advisor polls for messages from coach.
  // ─────────────────────────────────────────────
  if (action === "get-messages" && req.method === "GET") {
    const advisorId = url.searchParams.get("advisorId");
    if (!advisorId) return err("Missing advisorId");

    const messages = (await messageStore.get(`messages:${advisorId}`, { type: "json" }).catch(() => null)) || [];
    return ok(messages);
  }

  // ─────────────────────────────────────────────
  // POST /api/coach?action=mark-read
  // Marks all messages as read for an advisor.
  // Body: { advisorId }
  // ─────────────────────────────────────────────
  if (action === "mark-read" && req.method === "POST") {
    const { advisorId } = await req.json().catch(() => ({}));
    if (!advisorId) return err("Missing advisorId");

    const key = `messages:${advisorId}`;
    const messages = (await messageStore.get(key, { type: "json" }).catch(() => null)) || [];
    const updated = messages.map((m) => ({ ...m, read: true }));
    await messageStore.set(key, JSON.stringify(updated));
    return ok({ success: true });
  }

  return err("Unknown action", 404);
};

export const config = { path: "/api/coach" };
