// Prism Studio API — Element Tech
// A small shared backend so every visitor to Prism Studio can use the
// AI Edit Assistant without needing their own API key. The key lives
// only here, as a server environment variable, and is never sent to
// the browser. Uses Google's Gemini API (has a free tier).

const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // frames are base64 JPEGs, give some headroom

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// "gemini-flash-latest" is Google's rolling alias to their current
// recommended fast model, so this keeps working as Gemini versions
// come and go. Override with GEMINI_MODEL if you want to pin one.
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY is not set. /api/ai-edit and /api/ai-caption will return errors until it is added in Render → Environment.');
}

/* ---------------------------------------------------------------
   Tiny in-memory per-IP rate limiter.
   This is a shared key used by every visitor, so this cap protects
   your Gemini quota from any single visitor (or bot) hammering it.
   It resets whenever the server restarts/redeploys — fine for a
   small shared tool, not meant to be bulletproof.
--------------------------------------------------------------- */
const hits = new Map(); // ip -> array of request timestamps
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 20;          // per IP, per window

function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests from this device. Please wait a few minutes and try again.' });
  }
  recent.push(now);
  hits.set(ip, recent);
  next();
}

/* ---------------------------------------------------------------
   Gemini call
--------------------------------------------------------------- */
async function callGemini(imageBase64, systemPrompt, userText, opts = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        { text: userText },
      ],
    }],
    generationConfig: {
      maxOutputTokens: opts.maxTokens || 400,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  return (parts ? parts.map(p => p.text || '').join('\n') : '').trim();
}

const AI_EDIT_SYSTEM = `You are a professional color grading and reframing assistant built into a video editor called Prism Studio. You are shown one still frame from a clip and a plain-language instruction from the editor. Respond with ONLY a raw JSON object — no markdown fences, no prose before or after — matching exactly this shape:
{"brightness":100,"contrast":100,"saturation":100,"hue":0,"blur":0,"vignette":0,"scale":1,"x":0,"y":0,"explanation":"one short sentence"}
Rules:
- brightness/contrast/saturation are percentages, range 40-200, 100 means unchanged.
- hue is degrees, range -180 to 180, 0 means unchanged.
- blur is pixels, range 0-20, 0 means unchanged; use sparingly and only for an intentionally soft/dreamy look.
- vignette is 0-100, 0 means none; only raise it if the instruction implies mood, darkened edges, or a cinematic frame.
- scale is a zoom multiplier for the subject, range 0.5-2.5, 1 means unchanged; only change it if the instruction implies zooming or cropping in.
- x and y are horizontal/vertical reframing offsets as fractions of the frame, range -0.4 to 0.4, 0 means unchanged; only change them if the instruction implies recentering or repositioning the subject.
- explanation is one short sentence, under 18 words, written for the editor describing what you changed and why.
- If the instruction has nothing to do with visual editing, make minimal or no changes and say so in "explanation".
- Every value must be a plain number, never a string.`;

const AI_CAPTION_SYSTEM = `You write short on-screen captions for social video overlays. You are shown one frame. Reply with ONLY the caption text itself: no quotes, no markdown, no explanation, sentence case, 8 words or fewer.`;

function clamp(v, lo, hi, fallback) {
  const n = typeof v === 'number' && isFinite(v) ? v : fallback;
  return Math.max(lo, Math.min(hi, n));
}

/* ---------------------------------------------------------------
   Routes
--------------------------------------------------------------- */
app.get('/', (req, res) => {
  res.json({ service: 'prism-studio-api', status: 'ok', provider: 'gemini' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'prism-studio-api', provider: 'gemini', hasKey: !!GEMINI_API_KEY });
});

app.post('/api/ai-edit', rateLimit, async (req, res) => {
  try {
    const { imageBase64, instruction } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY' });

    const raw = await callGemini(imageBase64, AI_EDIT_SYSTEM, instruction || 'Improve this shot.', { maxTokens: 400, json: true });
    const clean = raw.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
    const parsed = JSON.parse(clean.slice(start, end + 1));

    res.json({
      brightness: clamp(parsed.brightness, 40, 200, 100),
      contrast: clamp(parsed.contrast, 40, 200, 100),
      saturation: clamp(parsed.saturation, 40, 200, 100),
      hue: clamp(parsed.hue, -180, 180, 0),
      blur: clamp(parsed.blur, 0, 20, 0),
      vignette: clamp(parsed.vignette, 0, 100, 0),
      scale: clamp(parsed.scale, 0.5, 2.5, 1),
      x: clamp(parsed.x, -0.4, 0.4, 0),
      y: clamp(parsed.y, -0.4, 0.4, 0),
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation.slice(0, 200) : 'Adjustments applied.',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI edit failed', detail: String(err.message || err).slice(0, 300) });
  }
});

app.post('/api/ai-caption', rateLimit, async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 is required' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY' });

    const raw = await callGemini(imageBase64, AI_CAPTION_SYSTEM, 'Write the caption.', { maxTokens: 60 });
    const caption = raw.replace(/^["']|["']$/g, '').trim();
    res.json({ caption });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Caption failed', detail: String(err.message || err).slice(0, 300) });
  }
});

app.listen(PORT, () => console.log(`Prism Studio API listening on port ${PORT}`));
