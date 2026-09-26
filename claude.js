// Serverless proxy for Policy Tabletop live sessions (Vercel Node function).
// Keeps the Anthropic API key on the server.
//
// Environment variables (set them in the host's project settings):
//   ANTHROPIC_API_KEY   required. Use a dedicated key with a monthly spend limit.
//   TABLETOP_PASSCODE   recommended. Live sessions need this passcode; the example session never does.
//   TABLETOP_ECONOMY    optional. Set to 1 to run every call on the lowest-cost model.
const MODELS = {
  quick: "claude-haiku-4-5-20251001",
  default: "claude-sonnet-5",
  complex: "claude-opus-5-5",
};
const MAX_PROMPT_CHARS = 60000;
const PASS = process.env.TABLETOP_PASSCODE || "";
const ECONOMY = process.env.TABLETOP_ECONOMY === "1";

function passOk(req) {
  if (!PASS) return true;
  const given = String(req.headers["x-tabletop-passcode"] || "");
  if (given.length !== PASS.length) return false;
  let diff = 0;
  for (let i = 0; i < PASS.length; i++) diff |= given.charCodeAt(i) ^ PASS.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  // Health check used by the page. Also reports whether a passcode is needed and whether the one sent is valid.
  if (req.method === "GET") {
    return res.status(200).json({ ok: !!process.env.ANTHROPIC_API_KEY, passcode: !!PASS, valid: passOk(req), economy: ECONOMY });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Server is missing ANTHROPIC_API_KEY" });
  if (!passOk(req)) return res.status(401).json({ error: "passcode" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const prompt = String(body.prompt || "");
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return res.status(400).json({ error: "Prompt missing or too long" });
  const model = ECONOMY ? MODELS.quick : (MODELS[body.tier] || MODELS.default);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: ECONOMY ? 3000 : 4000,
      system: "You are part of Policy Tabletop, a rehearsal tool for government staff. Follow the instructions in the user message exactly. When asked for JSON, reply with only the JSON value and no other text.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (r.status === 429) return res.status(429).json({ error: "Rate limited" });
  if (!r.ok) return res.status(502).json({ error: `Upstream error ${r.status}` });
  const data = await r.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return res.status(200).json({ text });
}
