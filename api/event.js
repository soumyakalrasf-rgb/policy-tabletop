// Policy Tabletop usage log.
//
// Two kinds of record, both off unless Supabase is configured:
//   1. Anonymous events: what people did (mode, seat counts, steers, exports),
//      never what they typed. The app sends none in Private mode, and none if
//      the person switched usage stats off or their browser asks not to be tracked.
//   2. Shared sessions: the question and brief of a live session, sent when the brief
//      is ready unless the person switched sharing off (the setup screen and the Start
//      button both say so). Personal details are removed in the browser first; documents
//      are never sent; never in Private mode. "Remove it" deletes the row.
//
// Environment variables (Vercel > Settings > Environment Variables):
//   SUPABASE_URL                 e.g. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    server-only key; never put it in the page
//   TABLETOP_ANALYTICS           optional, set to "off" to stop all logging
//   TABLETOP_RETENTION_DAYS      optional, default 90. Older rows are deleted automatically.
//
// Tables: see README, "Usage stats and shared sessions".

const URL_ = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ON = !!(URL_ && KEY) && String(process.env.TABLETOP_ANALYTICS || "").toLowerCase() !== "off";
// New-style secret keys (sb_secret_...) go only in the apikey header; legacy service_role JWTs also as a bearer token.
const AUTH = KEY.startsWith("eyJ") ? { apikey: KEY, authorization: `Bearer ${KEY}` } : { apikey: KEY };
const RETENTION_DAYS = Math.max(1, Number(process.env.TABLETOP_RETENTION_DAYS) || 90);

// Only these event names and property names are stored. Anything else is dropped,
// so free text can't slip into the event log by accident.
const EVENTS = new Set([
  "app_open", "screen", "setup_page", "question_drafted", "debate_start", "seat_add", "seat_remove",
  "steer", "stress_test", "brief_ready", "detail_open", "export", "print", "reality_check",
  "error", "clear", "share_open", "share_sent", "share_removed", "stats_off"
]);
const PROPS = new Set([
  "to", "page", "mode", "run", "tone", "style", "seats", "added", "removed", "has_context", "context_items",
  "mixed", "private_available", "kind", "src", "what", "answer", "code", "secs", "turns", "steers",
  "rounds", "horizon", "device", "entry", "second_opinion", "warnings", "include_transcript"
]);
const TOKEN = /^[a-z0-9_.:-]{1,40}$/i;

function cleanProps(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  for (const [k, v] of Object.entries(p)) {
    if (!PROPS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
  }
  return out;
}
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const clipList = (a, n, len) => (Array.isArray(a) ? a : []).slice(0, n).map(x => clip(x, len));

function cleanShare(b) {
  const s = b && typeof b === "object" ? b : {};
  const bottom = s.bottom && typeof s.bottom === "object" ? s.bottom : {};
  return {
    question: clip(s.question, 1200),
    headline: clip(s.headline, 400),
    bottom: { do: clip(bottom.do, 500), watch: clip(bottom.watch, 500), call: clip(bottom.call, 500) },
    options: clipList(s.options, 8, 200),
    seats: clipList(s.seats, 12, 120),
    landing: clipList(s.landing, 12, 300),
    risks: clipList(s.risks, 10, 200),
    actions: clipList(s.actions, 10, 400),
    note: clip(s.note, 1000),
    transcript: s.transcript ? clip(s.transcript, 60000) : null
  };
}

async function insert(table, row) {
  const r = await fetch(`${URL_}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(row)
  });
  if (!r.ok) throw new Error(`${table} ${r.status}`);
}
async function prune() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString();
  for (const t of ["events", "shares"]) {
    await fetch(`${URL_}/rest/v1/${t}?created_at=lt.${encodeURIComponent(cutoff)}`, {
      method: "DELETE", headers: AUTH
    }).catch(() => {});
  }
}

// Light per-instance limits so one tab can't flood the table.
const seen = new Map();
function allow(sid, cost) {
  const now = Date.now();
  const e = seen.get(sid) || { n: 0, t: now };
  if (now - e.t > 3600e3) { e.n = 0; e.t = now; }
  e.n += cost; seen.set(sid, e);
  if (seen.size > 5000) seen.clear();
  return e.n <= 400;
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") return res.status(200).json({ on: ON, retention_days: ON ? RETENTION_DAYS : undefined });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!ON) return res.status(200).json({ stored: false });

  // Same-site only.
  const origin = String(req.headers.origin || "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  if (origin && host && !origin.endsWith("//" + host)) return res.status(403).json({ error: "origin" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  if (body.private) return res.status(200).json({ stored: false }); // belt and braces: the app never sends these

  const sid = String(body.sid || "");
  if (!/^[a-z0-9-]{8,64}$/i.test(sid)) return res.status(400).json({ error: "sid" });

  try {
    const shareId = /^[a-z0-9-]{8,64}$/i.test(String(body.share_id || "")) ? String(body.share_id) : sid;
    if (body.kind === "unshare") {
      const r = await fetch(`${URL_}/rest/v1/shares?sid=eq.${encodeURIComponent(shareId)}`, { method: "DELETE", headers: AUTH });
      if (!r.ok) throw new Error("unshare " + r.status);
      await insert("events", { sid, type: "share_removed", props: {} });
      return res.status(200).json({ removed: true });
    }
    if (body.kind === "share") {
      if (!allow(sid, 40)) return res.status(429).json({ error: "slow down" });
      // One row per session: adding a note or the transcript replaces the earlier copy.
      await fetch(`${URL_}/rest/v1/shares?sid=eq.${encodeURIComponent(shareId)}`, { method: "DELETE", headers: AUTH });
      await insert("shares", { sid: shareId, mode: clip(body.mode, 20), brief: cleanShare(body.share) });
      await insert("events", { sid, type: "share_sent", props: cleanProps(body.props) });
    } else {
      const type = String(body.type || "");
      if (!EVENTS.has(type)) return res.status(400).json({ error: "type" });
      if (!allow(sid, 1)) return res.status(429).json({ error: "slow down" });
      await insert("events", { sid, type, props: cleanProps(body.props) });
    }
    if (Math.random() < 0.02) await prune();
    return res.status(200).json({ stored: true });
  } catch (e) {
    return res.status(200).json({ stored: false });
  }
}
