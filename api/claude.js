// Serverless proxy for Policy Tabletop live sessions (Vercel Node function).
// Keeps API keys on the server. Set these environment variables in the host's project settings.
//
//   PROVIDER            "openrouter" (open models, free tiers available), "anthropic" (Claude), or
//                       "mixed" (OpenRouter for the many small seat turns, Claude for setup, debate and outputs).
//                       Defaults to "openrouter" when only OPENROUTER_API_KEY is set, otherwise "anthropic".
//   OPENROUTER_API_KEY  for "openrouter" and "mixed". Create one at openrouter.ai/keys.
//   OPENROUTER_MODEL    optional. Preferred model IDs, separated by commas, tried first. After those, the server
//                       tries every other free model OpenRouter currently lists, until one gives a usable reply.
//   ANTHROPIC_API_KEY   for "anthropic" and "mixed". In "openrouter" mode it is an optional last resort:
//                       if every free model is busy, the request goes to Claude Haiku (a fraction of a cent).
//   TABLETOP_PASSCODE   optional. Live sessions need this passcode; the example session never does.
//   TABLETOP_ECONOMY    optional, Claude only. Set to 1 to run every Claude call on the lowest-cost model.

const CLAUDE = { quick: "claude-haiku-4-5-20251001", default: "claude-sonnet-5", complex: "claude-opus-5-5" };
const DEFAULT_PREFERRED = [
  "qwen/qwen3.8-27b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "openai/gpt-oss-120b:free",
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];
const PREFERRED = (process.env.OPENROUTER_MODEL ? process.env.OPENROUTER_MODEL.split(",") : DEFAULT_PREFERRED).map(m => m.trim()).filter(Boolean);
const PROVIDER = process.env.PROVIDER || (process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY ? "openrouter" : "anthropic");
const MAX_PROMPT_CHARS = 60000;
const PASS = process.env.TABLETOP_PASSCODE || "";
const ECONOMY = process.env.TABLETOP_ECONOMY === "1";
const BUDGET_MS = 240000;                 // stay under Vercel's 300-second limit (see vercel.json)
const MAX_MODELS_PER_REQUEST = 10;
const SYSTEM = "You are part of Policy Tabletop, a rehearsal tool for government staff. Follow the instructions in the user message exactly. When asked for JSON, reply with only the JSON value: no explanation, no markdown fences, no thinking out loud.";

export const config = { maxDuration: 300 };

/* ---------- helpers ---------- */
function passOk(req) {
  if (!PASS) return true;
  const given = String(req.headers["x-tabletop-passcode"] || "");
  if (given.length !== PASS.length) return false;
  let diff = 0;
  for (let i = 0; i < PASS.length; i++) diff |= given.charCodeAt(i) ^ PASS.charCodeAt(i);
  return diff === 0;
}
function configured() {
  if (PROVIDER === "openrouter") return !!process.env.OPENROUTER_API_KEY;
  if (PROVIDER === "mixed") return !!process.env.OPENROUTER_API_KEY && !!process.env.ANTHROPIC_API_KEY;
  return !!process.env.ANTHROPIC_API_KEY;
}
function label() {
  const lastResort = process.env.ANTHROPIC_API_KEY ? ", with Claude as a last resort" : "";
  if (PROVIDER === "openrouter") return `free open models via OpenRouter (${PREFERRED[0]} first, then others)${lastResort}`;
  if (PROVIDER === "mixed") return "free open models via OpenRouter for seat turns, Claude for the main steps";
  return ECONOMY ? "Claude (economy mode)" : "Claude";
}
async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

// Pull one JSON object out of a model reply, tolerating thinking blocks, code fences and extra prose.
export function extractJSON(raw) {
  let t = String(raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?think>/gi, "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  // Scan for balanced {...} blocks and keep the largest one that parses.
  let best;
  for (let start = t.indexOf("{"); start !== -1; start = t.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) {
        const chunk = t.slice(start, i + 1);
        try { const v = JSON.parse(chunk.replace(/,\s*([}\]])/g, "$1")); if (!best || chunk.length > best.len) best = { v, len: chunk.length }; } catch {}
        break;
      } }
    }
    if (best && best.len > t.length * 0.6) break;
  }
  return best ? best.v : undefined;
}

/* ---------- OpenRouter: try many free models ---------- */
let catalog = null, catalogAt = 0;
const cooldown = new Map(); // model -> time until which we skip it (kept while this server instance is warm)
const FAMILY_ORDER = [/qwen/i, /nemotron/i, /gpt-oss/i, /gemma/i, /llama/i, /deepseek/i, /glm/i, /mistral|magistral/i, /kimi/i];
const SKIP = /code|coder|devstral|fin:|sante|omni|vision|-vl|guard|embed|audio|image/i;

async function freeModels() {
  if (catalog && Date.now() - catalogAt < 30 * 60 * 1000) return catalog;
  try {
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/models", {}, 6000);
    const j = await r.json();
    catalog = (j.data || [])
      .filter(m => String(m.id).endsWith(":free") && (m.context_length || 0) >= 32000 && !SKIP.test(m.id))
      .map(m => m.id);
    catalogAt = Date.now();
  } catch { catalog = catalog || []; }
  return catalog;
}
async function candidateModels() {
  const cat = await freeModels();
  const known = new Set(cat);
  const preferred = PREFERRED.filter(id => !cat.length || known.has(id) || !id.endsWith(":free"));
  const rank = id => { const k = FAMILY_ORDER.findIndex(re => re.test(id)); return k === -1 ? 99 : k; };
  const rest = cat.filter(id => !preferred.includes(id)).sort((a, b) => rank(a) - rank(b));
  const all = [...preferred, ...rest];
  const ready = all.filter(id => !(cooldown.get(id) > Date.now()));
  return (ready.length ? ready : all).slice(0, MAX_MODELS_PER_REQUEST);
}
async function callOpenRouterModel(model, prompt, wantJson, ms, referer) {
  try {
    const r = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": referer || "https://github.com/soumyakalrasf-rgb/policy-tabletop",
        "X-Title": "Policy Tabletop",
      },
      body: JSON.stringify({
        model,
        max_tokens: 6000,
        temperature: 0.4,
        reasoning: { effort: "low", exclude: true },
        ...(wantJson ? { response_format: { type: "json_object" } } : {}),
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      }),
    }, ms);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) return { ok: false, status: r.ok ? 502 : r.status, detail: String(data.error?.message || data.error?.metadata?.raw || r.status) };
    return { ok: true, text: String(data.choices?.[0]?.message?.content || "") };
  } catch (e) {
    return { ok: false, status: 504, detail: e?.name === "AbortError" ? "timed out" : String(e?.message || e) };
  }
}
async function viaOpenRouter(prompt, wantJson, referer, deadline) {
  const models = await candidateModels();
  const tried = [];
  let lastDetail = "", dailyCap = false;
  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 8000) break;
    const out = await callOpenRouterModel(model, prompt, wantJson, Math.min(left - 3000, tried.length ? 60000 : 90000), referer);
    tried.push(model);
    if (out.ok) {
      if (!wantJson) return { text: out.text, model };
      const parsed = extractJSON(out.text);
      if (parsed !== undefined) return { text: JSON.stringify(parsed), model };
      lastDetail = `${model} gave an unreadable reply`;
      cooldown.set(model, Date.now() + 2 * 60 * 1000);
      continue;
    }
    lastDetail = `${model}: ${out.detail}`;
    if (/per[- ]?day|free-models-per-day/i.test(out.detail)) { dailyCap = true; break; } // every free model shares this cap
    cooldown.set(model, Date.now() + (out.status === 429 ? 60 : 180) * 1000);
  }
  return { failed: true, dailyCap, detail: `${tried.length} free model${tried.length === 1 ? "" : "s"} tried. Last: ${lastDetail}` };
}

/* ---------- Anthropic ---------- */
async function viaAnthropic(prompt, tier, wantJson, forceCheap) {
  const model = forceCheap || ECONOMY ? CLAUDE.quick : (CLAUDE[tier] || CLAUDE.default);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: ECONOMY || forceCheap ? 3000 : 4000, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return { failed: true, status: r.status, detail: String(e.error?.message || r.status) }; }
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  if (!wantJson) return { text, model };
  const parsed = extractJSON(text);
  return parsed === undefined ? { failed: true, detail: "Claude gave an unreadable reply" } : { text: JSON.stringify(parsed), model };
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    return res.status(200).json({ ok: configured(), passcode: !!PASS, valid: passOk(req), economy: ECONOMY, provider: PROVIDER, model: label() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!configured()) return res.status(503).json({ error: "Server is missing an API key for the selected provider" });
  if (!passOk(req)) return res.status(401).json({ error: "passcode" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const prompt = String(body.prompt || "");
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return res.status(400).json({ error: "Prompt missing or too long" });
  const tier = String(body.tier || "default");
  const wantJson = body.expect !== "text";
  const deadline = Date.now() + BUDGET_MS;

  let out;
  const useOpenRouter = PROVIDER === "openrouter" || (PROVIDER === "mixed" && tier === "quick");
  if (useOpenRouter) {
    out = await viaOpenRouter(prompt, wantJson, req.headers.origin, deadline);
    if (out.failed && process.env.ANTHROPIC_API_KEY && deadline - Date.now() > 15000) {
      const fb = await viaAnthropic(prompt, tier, wantJson, true);
      if (!fb.failed) out = { ...fb, fallback: true };
    }
  } else {
    out = await viaAnthropic(prompt, tier, wantJson, false);
  }
  if (out.failed) {
    if (out.dailyCap) return res.status(429).json({ error: "daily_cap", detail: out.detail });
    return res.status(503).json({ error: "busy", detail: out.detail });
  }
  return res.status(200).json({ text: out.text, model: out.model || "", fallback: !!out.fallback });
}
