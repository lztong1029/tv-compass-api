# TV Compass API

Node/Express backend for the TV Compass hybrid AI assistant. It keeps the Gemini API key off the iPhone, stores summarized preference memory, and can ask Gemini Vision for one camera-grounded next action.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

If `DATABASE_URL` is missing, the API uses an in-memory repository so the iOS app can still be tested locally.

## Railway

1. Create a Railway project.
2. Add a PostgreSQL service.
3. Deploy this `tv-compass-api` directory from GitHub.
4. Set environment variables:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL=gemini-2.5-flash`
   - `DATABASE_URL` from Railway Postgres
5. Set the iOS app backend URL to the Railway public URL.

## API

```http
POST /v1/assistant/parse
POST /v1/vision/next-step
GET /v1/memory/:userId
POST /v1/memory/:userId
DELETE /v1/memory/:userId
```

The parser returns a stable JSON shape:

```json
{
  "intent": "open_app",
  "targetApp": "Netflix",
  "targetChannel": null,
  "searchQuery": null,
  "inputName": null,
  "confidence": 0.91,
  "clarificationQuestion": null,
  "memoryUpdates": [{ "key": "lastTargetApp", "value": "Netflix" }],
  "source": "gemini"
}
```

The vision endpoint accepts a goal, OCR text, and an optional compressed JPEG frame:

```json
{
  "userId": "anonymous-device-id",
  "goal": {
    "intent": "open_channel",
    "title": "Open Live TV",
    "targetApp": null,
    "targetChannel": "Live TV",
    "searchQuery": null,
    "inputName": null
  },
  "recognizedTexts": ["Google TV", "Live TV", "Apps"],
  "imageBase64": "..."
}
```

It returns one grounded next action:

```json
{
  "sceneType": "tv",
  "action": "move_selection",
  "instructionText": "Move the highlight to Live TV, then press OK.",
  "spokenText": "Move the highlight to Live TV, then press OK.",
  "targetLabel": "Live TV",
  "targetButtonKind": "ok",
  "targetRect": null,
  "confidence": 0.82,
  "needsAnotherFrame": true,
  "reason": "Live TV is visible on the TV screen.",
  "source": "gemini"
}
```
