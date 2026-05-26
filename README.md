# TV Compass API

Node/Express backend for the TV Compass hybrid AI assistant. It keeps the Gemini API key off the iPhone and stores only summarized preference memory.

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
