import type { AssistantParseInput, AssistantParseResponse, MemorySnapshot } from "./types.js";

const structuredResponseSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["turn_on_tv", "open_app", "open_channel", "search_program", "change_input", "unknown"]
    },
    targetApp: { type: ["string", "null"] },
    targetChannel: { type: ["string", "null"] },
    searchQuery: { type: ["string", "null"] },
    inputName: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    clarificationQuestion: { type: ["string", "null"] },
    memoryUpdates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" }
        },
        required: ["key", "value"]
      }
    }
  },
  required: ["intent", "confidence", "memoryUpdates"]
};

export type GeminiGenerator = (input: AssistantParseInput, memory: MemorySnapshot) => Promise<unknown>;

export function createGeminiGenerator(apiKey: string | undefined, model = "gemini-2.5-flash"): GeminiGenerator | null {
  if (!apiKey) {
    return null;
  }

  return async (input, memory) => {
    const prompt = buildPrompt(input, memory);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseFormat: {
            text: {
              mimeType: "application/json",
              schema: structuredResponseSchema
            }
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    if (!text) {
      throw new Error("Gemini returned no text");
    }

    return JSON.parse(text) as AssistantParseResponse;
  };
}

function buildPrompt(input: AssistantParseInput, memory: MemorySnapshot): string {
  return [
    "You are the language understanding layer for TV Compass, an iPhone app that helps older adults use smart TVs and remotes.",
    "Return only the requested JSON structure.",
    "The iPhone app handles camera scanning, OCR, and step-by-step instructions. You only classify intent and suggest memory updates.",
    "",
    "Supported intents:",
    "- turn_on_tv",
    "- open_app: targetApp should be Netflix, YouTube, or another app name.",
    "- open_channel: targetChannel should be a channel or saved program name inferred from memory.",
    "- search_program: searchQuery should be a program, show, topic, or app if not directly supported.",
    "- change_input: inputName should be HDMI, HDMI 1, HDMI 2, etc.",
    "- unknown: use this if the request is unclear.",
    "",
    "Memory update keys allowed: preferredLanguage, lastTargetApp, lastTargetChannel, favoriteApp, favoriteChannel, lastSuccessfulTask, or alias:<phrase>.",
    "Do not mention private data. Do not request or process camera images.",
    "",
    `Utterance: ${input.utterance}`,
    `Recognized TV screen text: ${(input.recognizedScreenText ?? []).join(", ") || "none"}`,
    `Memory: ${JSON.stringify(memory)}`
  ].join("\n");
}
