# Prism Studio API

Shared backend for Prism Studio's AI Edit Assistant. Holds a Gemini API
key server-side (as an environment variable) so every visitor to the
Prism Studio website can use AI editing without pasting in their own key.

## Endpoints

- `GET /api/health` — `{ ok, service, provider, hasKey }`
- `POST /api/ai-edit` — body `{ imageBase64, instruction }`
- `POST /api/ai-caption` — body `{ imageBase64 }`

Rate-limited per IP (20 req / 15 min) since the key is shared. Gemini's
free tier also has its own rate limit on Google's side — check
aistudio.google.com/apikey if things start failing under load.

## Deploy

Push to GitHub, connect to Render as a Web Service, build `npm install`,
start `node server.js`, add `GEMINI_API_KEY` under Environment.
