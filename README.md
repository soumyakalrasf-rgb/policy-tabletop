# Policy Tabletop

A rehearsal tool for government staff. Simulated perspectives debate a policy decision over three rounds. The tool then produces an executive summary, open questions with where to look, a follow-up tracker and a decision memo. Seats are simulated roles, not real people; take every output to real experts before deciding.

## Low-cost live demo (recommended)

This repository deploys as-is to Vercel's free Hobby plan. That plan is for personal, non-commercial use. If this is for your employer, use Vercel Pro or your organization's hosting.

1. **Create a dedicated API key.** In the Anthropic Console (console.anthropic.com), create a new API key just for this demo. Then set a **monthly spend limit** in the Console's limits settings, for example $10. This is your hard cap.
2. **Import this repository into Vercel.** Sign in at vercel.com with GitHub, click **Add New → Project**, and import this repository. Leave the build settings as they are.
3. **Add three environment variables** before deploying:
   - `ANTHROPIC_API_KEY`: the key from step 1
   - `TABLETOP_PASSCODE`: a passcode you share with your demo audience
   - `TABLETOP_ECONOMY`: `1` (runs every call on the lowest-cost model)
4. Click **Deploy**. Share the site address and the passcode.

**What it costs:** hosting is $0. In economy mode, a full live session is roughly 20–30 cents of API usage, and your spend limit caps the total. Anyone can run the example session for free, with no passcode and no API calls.

## Other ways to run it

- **GitHub Pages (free, static).** Turn on Pages for this repository (Settings → Pages → branch `main`, folder `/`). The example session works for everyone. For a live session, a visitor pastes their own Anthropic API key, which stays in their browser.
- **Inside Claude.** The Claude-hosted version runs live sessions on each viewer's own Claude plan, with no API key needed.
- **Your organization's hosting.** `api/claude.js` is a small Node function. It can be adapted for Azure Functions, AWS Lambda or an internal server behind your organization's sign-in.

## Before staff use it with real matters

- **Data:** live sessions send the question, background notes and transcript to Anthropic's API. Confirm this fits your data rules.
- **Records:** ask counsel how transcripts, decision records and saved sessions are treated.
- **Consent:** get consent before recording anyone's voice. On hosted copies, the microphone button uses the browser's speech service; in Chrome, that sends audio to Google.

## Files

- `index.html`: the whole app
- `api/claude.js`: server function that calls the Anthropic API with passcode and economy mode
- `package.json`: marks the function as an ES module, Node 18+
