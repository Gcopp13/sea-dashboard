// netlify/functions/coach.mjs
import { getStore } from "@netlify/blobs";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ok  = (data) => new Response(JSON.stringify(data), { status: 200, headers: CORS });
const err = (msg, code) => new Response(JSON.stringify({ error: msg }), { status: code || 400, headers: CORS });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  // Diagnostic ping — open in browser to test blobs
  if (action === "ping") {
    try {
      const store = getStore("sea-advisors");
      await store.setJSON("__ping__", { ts: Date.now() });
      const back = await store.get("__ping__", { type: "json" });
      return ok({ ping: "ok", blobs: "working", echo: back });
    } catch (e) {
      return ok({ ping: "ok", blobs: "ERROR", message: e.message });
    }
  }

  // POST share
  if (action === "share" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!body?.advisorId || !body?.coachId) return err("Missing advisorId or coachId");
      const store = getStore("sea-advisors");
      await store.setJSON(`${body.coachId}__${body.advisorId}`, {
        advisorId: body.advisorId, coachId: body.coachId,
        advisorData: body.advisorData || {}, lastUpdated: Date.now(),
      });
      return ok({ success: true });
    } catch (e) { return err("share error: " + e.message, 500); }
  }

  // GET get-advisors
  if (action === "get-advisors" && req.method === "GET") {
    const coachId = url.searchParams.get("coachId");
    if (!coachId) return err("Missing coachId");
    try {
      const store = getStore("sea-advisors");
      const { blobs } = await store.list({ prefix: `${coachId}__` });
      if (!blobs || blobs.length === 0) return ok([]);
      const advisors = await Promise.all(blobs.map(async (b) => {
        try { return await store.get(b.key, { type: "json" }); } catch { return null; }
      }));
      return ok(advisors.filter(Boolean).sort((a, b) => (b.lastUpdated||0) - (a.lastUpdated||0)));
    } catch (e) { return err("get-advisors error: " + e.message, 500); }
  }

  // POST send-message
  if (action === "send-message" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!body?.advisorId || !body?.message) return err("Missing advisorId or message");
      const store = getStore("sea-messages");
      const key = `msg__${body.advisorId}`;
      const existing = (await store.get(key, { type: "json" })) || [];
      existing.push({ id: crypto.randomUUID(), coachId: body.coachId||"coach",
        coachName: body.coachName||"Your Coach", message: body.message,
        timestamp: Date.now(), read: false });
      await store.setJSON(key, existing.slice(-50));
      return ok({ success: true });
    } catch (e) { return err("send-message error: " + e.message, 500); }
  }

  // GET get-messages
  if (action === "get-messages" && req.method === "GET") {
    const advisorId = url.searchParams.get("advisorId");
    if (!advisorId) return err("Missing advisorId");
    try {
      const store = getStore("sea-messages");
      return ok((await store.get(`msg__${advisorId}`, { type: "json" })) || []);
    } catch { return ok([]); }
  }

  // POST mark-read
  if (action === "mark-read" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!body?.advisorId) return err("Missing advisorId");
      const store = getStore("sea-messages");
      const key = `msg__${body.advisorId}`;
      const msgs = (await store.get(key, { type: "json" })) || [];
      await store.setJSON(key, msgs.map(m => ({ ...m, read: true })));
      return ok({ success: true });
    } catch (e) { return err("mark-read error: " + e.message, 500); }
  }

  return err("Unknown action", 404);
};

export const config = { path: "/api/coach" };
