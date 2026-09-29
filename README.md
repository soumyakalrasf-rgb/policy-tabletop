# Policy Tabletop

A rehearsal tool for government staff. Simulated perspectives debate a policy decision, then the tool produces a one-page executive brief: the hardest objections and who raises them, the strongest case against the option you favor, what you can't answer yet, who is missing, a stakeholder tension table, and what would change each seat's mind. Choose a quick brief (about a minute, six seats) or a full workshop (three rounds, you can steer). Seats are simulated roles, not real people; take every output to real experts before deciding.

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

Free models are shared and often busy, which makes sessions slow. The server now uses DeepSeek V4.1 Flash first whenever your OpenRouter account has credit, and falls back to free models when it does not. Add a few dollars of credit to switch it on; no settings needed. It costs about $0.035 per million input tokens and $0.29 per million output tokens, roughly one cent per full session. Seat turns then run six at a time (set `TABLETOP_PARALLEL` to change this), requests go to the fastest host, and a stalled request is retried once before the free models step in as backup.

### Other providers

- **Claude (best quality):** set `PROVIDER` to `anthropic`, `ANTHROPIC_API_KEY` to a dedicated key with a monthly spend limit, and optionally `TABLETOP_ECONOMY` to `1`. A session costs roughly 20–30 cents in economy mode.
- **Mixed:** set `PROVIDER` to `mixed` with both keys. The many small seat turns run on the OpenRouter model, and setup, debate and outputs run on Claude.

## Other ways to run it

- **GitHub Pages (free, static).** Turn on Pages for this repository (Settings → Pages → branch `main`, folder `/`). The example session works for everyone. For a live session, a visitor pastes their own OpenRouter or Anthropic key, which stays in their browser.
- **Inside Claude.** The Claude-hosted version runs live sessions on each viewer's own Claude plan, with no API key needed.
- **Your organization's hosting.** `api/claude.js` is a small Node function. It can be adapted for Azure Functions, AWS Lambda or an internal server behind your organization's sign-in.

## Mixed AI models

Seats built on one model tend to agree with themselves. When the OpenRouter account has credit, seats are voiced by models from different companies (by default DeepSeek, Qwen, gpt-oss and Llama). The Red Team and the absent voice get families no regular seat uses. In the debate round each seat writes its own turn on its own model. A separate model (GLM) that voiced no seat writes the brief, and another (Mistral) gives a second opinion on whether the brief fairly represents the transcript. Every turn records which model voiced it, in the app and in the downloads. People can switch to "One model" on the review screen. Change the models with `OPENROUTER_VOICES`.

## Privacy

- **Background material is never stored,** and the model server does not log prompts or replies. If you set up usage stats (below), live sessions share their question and brief by default unless the person switches it off; Private mode never shares. Documents (PDF, Word, text) are converted to text inside the browser; the files are never uploaded.
- **Personal details are removed before sending** (emails, phone numbers, ID, tax and account numbers, street addresses), and the setup screen shows exactly what will be sent. Names are not removed automatically; check the preview.
- **Private mode** sends requests only to OpenRouter hosts with zero data retention that do not collect or train on prompts (`provider.zdr` and `data_collection: "deny"`). It turns on automatically when background material is added, never falls back to free models or Claude, and needs OpenRouter credit. Change its models with `OPENROUTER_PRIVATE_MODEL`.
- **Clear everything** erases the session, background material and any saved key from the browser.
- For stricter requirements, host the tool yourself and point it at a model service your organization already approves.

## Usage stats and shared sessions (optional)

Off until you add Supabase keys. Two kinds of record:

- **Anonymous events**: what people did, never what they typed. For example: which mode they picked, how many seats, seats added or removed, steers, how long the brief took, exports clicked, errors, the "did this match the real meeting?" answer. The server keeps only a fixed list of event names and short values, so free text can't slip in. No names, emails or IP addresses are stored; each visit gets a random ID that resets when the tab closes or the person clears everything.
- **Shared sessions** (on by default, easy to switch off): when a live brief is ready, its question, bottom line, options, seats, where they landed, risks and open questions are sent, with personal details removed first. Background documents are never included. The setup screen and the table screen, right before Start, both say this and offer **Don't share** (remembered in that browser). After the brief, people can add a note or the transcript, or click **Remove it**, which deletes the row.

Nothing is sent in Private mode (and for the rest of that session once Private mode has been on), or in the scripted example. Browsers that send Do Not Track or Global Privacy Control start with both stats and sharing off. Stats and sharing are switched off separately. Rows older than `TABLETOP_RETENTION_DAYS` (default 90) are deleted automatically.

Setup:

1. Create a free project at supabase.com. In **SQL Editor**, run:

```sql
create table events (id bigint generated always as identity primary key, created_at timestamptz not null default now(), sid text not null, type text not null, props jsonb not null default '{}');
create table shares (id bigint generated always as identity primary key, created_at timestamptz not null default now(), sid text not null, mode text, brief jsonb not null);
alter table events enable row level security;
alter table shares enable row level security;
create index on events (created_at); create index on events (type); create index on shares (created_at);
```

Row level security with no policies means only the server key can read or write.

2. In Vercel, **Settings > Environment Variables**, add `SUPABASE_URL` (Project Settings > API > Project URL) and `SUPABASE_SERVICE_ROLE_KEY` (the `service_role` secret). Never put that key in the page or in chat. Redeploy.
3. Check `/api/event` returns `{"on":true}`. Set `TABLETOP_ANALYTICS=off` to stop all logging without removing the keys.

Useful queries:

```sql
-- funnel: visits, debates started, briefs finished, exports
select type, count(distinct sid) from events where type in ('app_open','debate_start','brief_ready','export','share_sent') group by type;
-- which exports people use
select props->>'what' as what, count(*) from events where type='export' group by 1;
-- where people get stuck
select props->>'code' as code, count(*) from events where type='error' group by 1 order by 2 desc;
-- recent shared questions and notes
select created_at, brief->>'question' as question, brief->>'note' as note from shares order by created_at desc limit 20;
```

## Before staff use it with real matters

- **Data:** live sessions send the question, background notes and transcript to the model provider you choose (OpenRouter and its model hosts, or Anthropic). Confirm this fits your data rules.
- **Records:** ask counsel how transcripts, decision records and saved sessions are treated.
- **Consent:** get consent before recording anyone's voice. On hosted copies, the microphone button uses the browser's speech service; in Chrome, that sends audio to Google.

## Files

- `index.html`: the whole app
- `api/claude.js`: server function that calls OpenRouter or Anthropic, with passcode and economy mode
- `api/event.js`: optional usage stats and opt-in shared sessions (Supabase)
- `package.json`: marks the function as an ES module, Node 18+
