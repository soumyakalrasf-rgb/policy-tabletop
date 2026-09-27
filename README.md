# Policy Tabletop

A rehearsal tool for government staff. Simulated perspectives debate a policy decision over three rounds. The tool then produces an executive summary, open questions with where to look, a follow-up tracker and a decision memo. Seats are simulated roles, not real people; take every output to real experts before deciding.

## Free live demo with open models (OpenRouter)

This repository deploys as-is to Vercel's free Hobby plan (personal, non-commercial use). Live sessions can run on free open-weight models through OpenRouter.

1. **Get an OpenRouter key.** Sign up at openrouter.ai and create a key at openrouter.ai/keys. In your OpenRouter privacy settings, allow free model endpoints. Some free providers log or train on prompts, so never paste sensitive material.
2. **Import this repository into Vercel.** Sign in at vercel.com with GitHub, click **Add New → Project**, and import this repository. Leave the build settings as they are.
3. **Add environment variables** before deploying:
   - `PROVIDER`: `openrouter`
   - `OPENROUTER_API_KEY`: your key
   - `TABLETOP_PASSCODE`: a passcode you share with your demo audience
   - `OPENROUTER_MODEL` (optional): preferred model IDs separated by commas. They're tried first; after them, the server tries every other free model OpenRouter lists, up to 10 per request, until one gives a readable reply.
   - `ANTHROPIC_API_KEY` (optional, recommended): a last resort. If every free model is busy, the request goes to Claude Haiku for a fraction of a cent, so users always get a response. Set a small monthly spend limit on this key.
4. Click **Deploy**. Share the site address and the passcode.

**Limits of free models:** OpenRouter allows 20 requests a minute on free models. It allows 50 a day on accounts that have bought less than $10 of credit (about one or two full sessions), and 1,000 a day after a one-time $10 purchase. When a free model is busy, slow or gives a reply that can't be read, the server moves to the next free model, and each request can take up to 5 minutes. If the daily limit is used up, it says so. Open models follow the tool's rules (clean structured output, cite only listed sources) less reliably than Claude, so expect some retries.

### Faster and still nearly free: DeepSeek V4.1 Flash

Free models are shared and often busy, which makes sessions slow. The server now uses DeepSeek V4.1 Flash first whenever your OpenRouter account has credit, and falls back to free models when it does not. Add a few dollars of credit to switch it on; no settings needed. It costs about $0.035 per million input tokens and $0.29 per million output tokens, roughly one cent per full session. Seat turns then run three at a time, and the free models stay as automatic backup.

### Other providers

- **Claude (best quality):** set `PROVIDER` to `anthropic`, `ANTHROPIC_API_KEY` to a dedicated key with a monthly spend limit, and optionally `TABLETOP_ECONOMY` to `1`. A session costs roughly 20–30 cents in economy mode.
- **Mixed:** set `PROVIDER` to `mixed` with both keys. The many small seat turns run on the OpenRouter model, and setup, debate and outputs run on Claude.

## Other ways to run it

- **GitHub Pages (free, static).** Turn on Pages for this repository (Settings → Pages → branch `main`, folder `/`). The example session works for everyone. For a live session, a visitor pastes their own OpenRouter or Anthropic key, which stays in their browser.
- **Inside Claude.** The Claude-hosted version runs live sessions on each viewer's own Claude plan, with no API key needed.
- **Your organization's hosting.** `api/claude.js` is a small Node function. It can be adapted for Azure Functions, AWS Lambda or an internal server behind your organization's sign-in.

## Before staff use it with real matters

- **Data:** live sessions send the question, background notes and transcript to the model provider you choose (OpenRouter and its model hosts, or Anthropic). Confirm this fits your data rules.
- **Records:** ask counsel how transcripts, decision records and saved sessions are treated.
- **Consent:** get consent before recording anyone's voice. On hosted copies, the microphone button uses the browser's speech service; in Chrome, that sends audio to Google.

## Files

- `index.html`: the whole app
- `api/claude.js`: server function that calls OpenRouter or Anthropic, with passcode and economy mode
- `package.json`: marks the function as an ES module, Node 18+
