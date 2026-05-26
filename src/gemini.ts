import type {
  AssistantParseInput,
  AssistantParseResponse,
  MemorySnapshot,
  VisionNextStepInput,
  VisionNextStepResponse
} from "./types.js";

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

const visionResponseSchema = {
  type: "object",
  properties: {
    sceneType: { type: "string", enum: ["remote", "tv", "unknown"] },
    action: {
      type: "string",
      enum: ["point_camera", "press_button", "move_selection", "wait", "ask_clarification", "done"]
    },
    instructionText: { type: "string" },
    spokenText: { type: "string" },
    targetLabel: { type: ["string", "null"] },
    targetButtonKind: { type: ["string", "null"] },
    targetRect: {
      type: ["object", "null"],
      properties: {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
        width: { type: "number", minimum: 0, maximum: 1 },
        height: { type: "number", minimum: 0, maximum: 1 }
      },
      required: ["x", "y", "width", "height"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needsAnotherFrame: { type: "boolean" },
    reason: { type: ["string", "null"] }
  },
  required: ["sceneType", "action", "instructionText", "spokenText", "confidence", "needsAnotherFrame"]
};

export type GeminiGenerator = (input: AssistantParseInput, memory: MemorySnapshot) => Promise<unknown>;
export type GeminiVisionGenerator = (input: VisionNextStepInput, memory: MemorySnapshot) => Promise<unknown>;

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
          responseMimeType: "application/json",
          responseJsonSchema: structuredResponseSchema
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

export function createGeminiVisionGenerator(apiKey: string | undefined, model = "gemini-2.5-flash"): GeminiVisionGenerator | null {
  if (!apiKey) {
    return null;
  }

  return async (input, memory) => {
    const prompt = buildVisionPrompt(input, memory);
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (input.imageBase64) {
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: input.imageBase64
        }
      });
    }

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
            parts
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: visionResponseSchema
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini vision request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
    if (!text) {
      throw new Error("Gemini vision returned no text");
    }

    return JSON.parse(text) as VisionNextStepResponse;
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
    "- open_channel: targetChannel should be a channel, Live TV, Antenna TV, or saved program name inferred from memory.",
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

function buildVisionPrompt(input: VisionNextStepInput, memory: MemorySnapshot): string {
  return [
    "You are the camera-grounded guidance layer for TV Compass, an iPhone app for older adults who do not know where TV remote buttons or TV menu items are.",
    "The user has already stated a goal. Your job is to inspect the current camera frame and OCR text, then return exactly one next action.",
    "Do not give a generic multi-step recipe. Only describe what to do in the current camera scene.",
    "High visual guidance is the product. If the target button or TV item is visible, return a targetRect so the iPhone can draw a yellow highlight.",
    "A rough estimated targetRect is better than null. Use null only when the target is not visible or the frame is too unclear.",
    "targetRect coordinates are normalized to the attached image: x and y are the top-left corner, width and height are the target box size, all from 0 to 1.",
    "If the remote is visible, identify the relevant button and return a targetRect around the button when it is visible.",
    "If the TV screen is visible, identify the relevant on-screen tile, menu item, input, app, or channel and return targetRect when visible.",
    "When action is press_button or move_selection and the target is visible, targetRect should not be null.",
    "If the frame is unclear, tell the user how to move the phone: closer, point at the remote, point at the TV screen, or reduce glare.",
    "Use short plain English. Write spokenText as one calm sentence for voice output.",
    "Return only the requested JSON structure.",
    "",
    "Button kind values when applicable: power, home, back, ok, up, down, left, right, volumeUp, volumeDown, input, netflix, youtube, mute, settings.",
    "Scene types: remote, tv, unknown.",
    "Actions:",
    "- point_camera: the camera is not showing the useful object yet.",
    "- press_button: a physical remote button should be pressed.",
    "- move_selection: an on-screen item should be selected or highlighted.",
    "- wait: the user should wait for loading or screen change.",
    "- ask_clarification: the goal cannot be resolved from memory and scene.",
    "- done: the goal appears complete.",
    "",
    `Goal: ${JSON.stringify(input.goal)}`,
    `Recognized OCR text: ${(input.recognizedTexts ?? []).join(", ") || "none"}`,
    `Memory: ${JSON.stringify(memory)}`,
    input.imageBase64 ? "A current camera JPEG is attached." : "No camera image is attached."
  ].join("\n");
}
