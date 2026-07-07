# AI Life Assistant POC

A browser-first POC that turns messy natural-language life input into a calm daily dashboard for old phones, tablets, and spare browser screens.

## What Is Built

- Next.js + TypeScript + Tailwind PWA shell.
- Pages: `/`, `/input`, `/dashboard`, `/settings`.
- Local `localStorage` state.
- Volcengine Agent Plan interpreter endpoint at `/api/ai/interpret`.
- Volcengine Agent Plan speech endpoints at `/api/ai/asr` and `/api/ai/tts`.
- Rule-based fallback for simple tasks, shopping, mood, travel, completion, and recurring hints.
- Sparse dashboard with hard limits.
- Display mode for always-on spare screens.

## Run Locally

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000`.

## Agent Plan Setup

Create `.env.local` from `.env.example` and set:

```bash
AI_PROVIDER=volcengine_agent_plan_runtime
ALLOW_AGENT_PLAN_RUNTIME=true
AI_PARSE_ENABLED=true
ARK_AGENT_PLAN_API_KEY=your-agent-plan-api-key
ARK_AGENT_PLAN_OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
ARK_AGENT_PLAN_CHAT_MODEL=doubao-seed-2.0-lite
ARK_TTS_URL=https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional
ARK_TTS_RESOURCE_ID=seed-tts-2.0
ARK_ASR_URL=wss://openspeech.bytedance.com/api/v3/plan/sauc/bigmodel_async
ARK_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
```

The app sends natural-language interpretation requests through the backend route `/api/ai/interpret`. The default language model is `doubao-seed-2.0-lite`; the Settings page can switch models per request. If the key is missing or the Agent Plan request fails, the POC falls back to local parsing so the demo remains usable.

Voice input records audio in the browser and sends it to `/api/ai/asr`. Voice playback sends text to `/api/ai/tts`, which uses the Agent Plan HTTP TTS endpoint. Browser-native speech is kept only as a local fallback when the Agent Plan speech route is unavailable.

## POC Limits

- No auth yet.
- No Supabase persistence yet.
- Real AI interpretation is wired through Agent Plan, but not exercised without your runtime key.
- No weather API yet; weather prompts are planned for a later phase.

## Try These Inputs

- `send report by 5pm`
- `buy milk`
- `I am tired today`
- `I finished report`
- `这周五去苏州`
- `我需要买牛奶`
- `已经下单了牛奶，明早送到`
