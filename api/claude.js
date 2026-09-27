// Serverless proxy for Policy Tabletop live sessions (Vercel Node function).
// Keeps API keys on the server. Set these environment variables in the host's project settings.
//
//   PROVIDER            "openrouter" (open models, free tiers available), "anthropic" (Claude), or
//                       "mixed" (OpenRouter for the many small seat turns, Claude for setup, debate and outputs).
//                       Defaults to "openrouter" when only OPENROUTER_API_KEY is set, otherwise "anthropic".
//   OPENROUTER_API_KEY  for "openrouter" and "mixed". Create one at openrouter.ai/keys.
//   OPENROUTER_MODEL    optional. One model ID, or several separated by commas to try in order when one is busy.
//                       Defaults to a list of free models.
//   ANTHROPIC_API_KEY   for "anthropic" and "mixed". Use a dedicated key with a monthly spend limit.
//   TABLETOP_PASSCODE   recommended. Live sessions need this passcode; the example session never does.
//   TABLETOP_ECONOMY    optional, Claude only. Set to 1 to run every Claude call on the lowest-cost model.
const CLAUDE = {
  quick: "claude-haiku-4-5-20251001",
  default: "claude-sonnet-5",
  complex: "claude-opus-5-5",
};
const OR_MODELS = (process.env.OPENROUTER_MODEL || "qwen/qwen3.8-27b:free,nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3-ultra-550b-a55b:free")
  .split(",").map(m => m.trim()).filter(Boolean).slice(0, 3);
const OR_MODEL = OR_MODELS[0];
const PROVIDER = process.env.PROVIDER || (process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY ? "openrouter" : "anthropic");
const MAX_PROMPT_CHARS = 60000;
const PASS = process.env.TABLETOP_PASSCODE || "";
const ECONOMY = process.env.TABLETOP_ECONOMY === "1";
const SYSTEM = "You are part of Policy Tabletop, a rehearsal tool for government staff. Follow the instructions in the user message exactly. When asked for JSON, reply with only the JSON value and no other text.";

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
function route(tier) {
  if (PROVIDER === "openrouter") return "openrouter";
  if (PROVIDER === "mixed") return tier === "quick" ? "openrouter" : "anthropic";
  return "anthropic";
}
function label() {
  if (PROVIDER === "openrouter") return `${OR_MODEL} via OpenRouter${OR_MODELS.length > 1 ? `, with ${OR_MODELS.length - 1} free fallback model${OR_MODELS.length > 2 ? "s" : ""}` : ""}`;
  if (PROVIDER === "mixed") return `${OR_MODEL} via OpenRouter for seat turns, Claude for the main steps`;
  return ECONOMY ? "Claude (economy mode)" : "Claude";
}

async function callAnthropic(prompt, tier) {
  const model = ECONOMY ? CLAUDE.quick : (CLAUDE[tier] || CLAUDE.default);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: ECONOMY ? 3000 : 4000, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); return { status: r.status, detail: String(e.error?.message || "") }; }
  const data = await r.json();
  return { text: (data.content || []).filter(b => b.type === "text").map(b => b.text).join("") };
}
async function callOpenRouter(prompt, referer) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": referer || "https://github.com/soumyakalrasf-rgb/policy-tabletop",
      "X-Title": "Policy Tabletop",
    },
    // "models" lets OpenRouter move to the next model when one is rate-limited or down.
    body: JSON.stringify({ models: OR_MODELS, max_tokens: 4000, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) return { status: r.ok ? 502 : r.status, detail: String(data.error?.message || data.error?.metadata?.raw || "") };
  return { text: String(data.choices?.[0]?.message?.content || ""), model: data.model };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // Health check used by the page: whether live is configured, whether a passcode is needed and valid, and which model runs.
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

  const out = route(tier) === "openrouter"
    ? await callOpenRouter(prompt, req.headers.origin)
    : await callAnthropic(prompt, tier);
  if (out.status === 429) return res.status(429).json({ error: "Rate limited", detail: out.detail || "" });
  if (out.status) return res.status(502).json({ error: `Upstream error ${out.status}`, detail: out.detail || "" });
  return res.status(200).json({ text: out.text, model: out.model || "" });
}
