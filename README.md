# Policy Tabletop: deployment

Three ways to run it, from least to most setup.

## 1. Share it from Claude (no setup)

The tool is already published as a Claude artifact. Open it in Claude, use **Share**, and choose who can open it.

- The example session works for anyone who can open the link.
- Live sessions run on each viewer's own Claude account. Viewers need Claude access, and Claude asks each of them once for permission.
- In-page microphone recording is blocked inside Claude, so the page points people to their device's dictation instead.

## 2. Static hosting (GitHub Pages, intranet, SharePoint)

Upload the `index.html` from the GitHub Pages package to any static host.

- The example session, summary, memo and downloads all work.
- **Live sessions:** open Live session and paste an Anthropic API key (from console.anthropic.com) into "Connect live generation." The page then calls Anthropic directly from that browser. The key is kept in memory, or until the tab closes if you tick "Remember." Use this for your own testing only. Anyone at that browser could use the key while it's connected, so set a spend limit in the Anthropic Console. For staff use, go with option 3.

## 3. Hosted with live sessions (recommended for staff without Claude accounts)

This folder is ready for Vercel. The same layout works on Netlify with a small change to the function's export.

1. Put this folder in a Git repository, or run `npx vercel` from inside it.
2. In the host's project settings, add the environment variable `ANTHROPIC_API_KEY` with a key from console.anthropic.com.
3. Deploy. The page calls `/api/claude`, and the function keeps the key on the server.
4. **Put the site behind your organization's sign-in** (Vercel password protection or SSO, or an internal host behind your identity provider). Without this, anyone with the URL can spend your API credit.

On a hosted site, the question box gets a microphone button in browsers that support speech recognition, such as Chrome and Edge. The browser's speech service does the transcription; in Chrome that means audio goes to Google. Check that this is acceptable before enabling it for staff.

Rebuild `index.html` after changing the main page with `python3 build.py`.

## Before staff use it with real matters

- **Security and procurement review.** Live sessions send the question, context and transcript to Anthropic's API. Confirm this fits your data classification rules, and do not paste material staff are not allowed to share that way.
- **Records and open-meetings law.** Ask counsel how transcripts, decision records and session files are treated, and set a retention rule.
- **Consent.** Get consent before recording anyone's voice.
- **Cost controls.** A full live session is about 25 to 30 model calls. Set spend limits in the Anthropic Console.

## Files

- `index.html`: the full page, built from `../index.html` by `build.py`
- `api/claude.js`: serverless proxy to the Anthropic Messages API
- `package.json`: marks the function as an ES module, Node 18+
