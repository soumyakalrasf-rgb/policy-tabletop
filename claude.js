// Serverless proxy for Policy Tabletop live sessions (Vercel / Netlify-style Node function).
// Keeps the Anthropic API key on the server. Set ANTHROPIC_API_KEY in the host's environment settings.
const MODELS = {
  quick: "claude-haiku-4-5-20251001",
  default: "claude-sonnet-5",
  complex: "claude-opus-5-5",
};
const MAX_PROMPT_CHARS = 60000;

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ ok: true }); // health check used by the page
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Server is missing ANTHROPIC_API_KEY" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const prompt = String(body.prompt || "");
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return res.status(400).json({ error: "Prompt missing or too long" });
  const model = MODELS[body.tier] || MODELS.default;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
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
