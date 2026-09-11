# Prism Studio API

Shared backend for Prism Studio's AI Edit Assistant. Holds the Anthropic
API key server-side (as an environment variable) so every visitor to the
Prism Studio website can use AI editing without pasting in their own key.

## Endpoints

- `GET /api/health` — `{ ok, service, hasKey }`, use this to confirm the
  server is up and has a key configured.
- `POST /api/ai-edit` — body `{ imageBase64, instruction }`, returns
  color/transform adjustments as JSON.
- `POST /api/ai-caption` — body `{ imageBase64 }`, returns `{ caption }`.

Both AI routes are rate-limited per IP (20 requests / 15 minutes by
default — adjust `MAX_REQUESTS` / `WINDOW_MS` in `server.js`) since the
key is shared across everyone using the site.

## Run locally (in Termux)

```
pkg install nodejs -y
cd prism-studio-api
npm install
cp .env.example .env
# edit .env and paste your real ANTHROPIC_API_KEY
node server.js
```

## Deploy to Render

See the deployment walkthrough from Element Tech — short version:
push this folder to a GitHub repo, create a Render Web Service from it,
set the build command to `npm install`, the start command to
`node server.js`, and add `ANTHROPIC_API_KEY` under Render's
Environment tab.
