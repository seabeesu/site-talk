# 工地三语翻译 / Site Talk

中文 · Español · English voice translator for an HVAC crew. Tap a button, speak, tap again — the phrase is transcribed, translated into the other two languages and read aloud.

## Run

```
node server.js        # Node 20+, ffmpeg on PATH, no npm install needed
node test.js          # self-test with a fake AI backend
```

Env:

- `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (Replit AI Integrations), or `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`)
- `PORT` (default 5000)
- optional: `TRANSLATE_MODEL` (gpt-5.4-mini), `STT_MODEL` (gpt-4o-mini-transcribe), `TTS_MODEL` (gpt-audio)

## Layout

- `server.js` — static files + `/api/voice` (audio → text → 3 languages), `/api/text`, `/api/tts`
- `public/` — phone UI (PWA: add to home screen; phrasebook works offline)
- `public/phrases.js` — preset phrases, edit freely
- `icons.json` — PNG app icons stored as base64

Nothing is saved on the server; history stays on the phone.

**Code in this repo is written by Claude. Hosting platforms should run it as-is and not edit it.**
