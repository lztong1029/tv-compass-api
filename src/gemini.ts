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
    currentState: { type: ["string", "null"] },
    nextCheckpoint: { type: ["string", "null"] },
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
    "- open_channel: targetChannel should be a channel, Live TV, Antenna TV, a live news target, or a saved channel inferred from memory.",
    "- search_program: searchQuery should be a program, show, movie, sports event, or topic. If the user names a streaming app or service too, also set targetApp.",
    "- change_input: inputName should be HDMI, HDMI 1, HDMI 2, etc.",
    "- unknown: use this if the request is unclear.",
    "",
    "Important distinctions:",
    "- If the user asks to open HBO, Max, Hulu, Disney+, etc., use open_app.",
    "- If the user asks to watch a title inside a service, such as 'Euphoria on HBO' or 'The Bear on Hulu', use search_program with searchQuery as the title and targetApp as the service.",
    "- Do not collapse a content request into just opening the app.",
    "- If the user asks for live TV, live news, cable, antenna, or news live streaming, use open_channel unless they named a specific app.",
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
    "You are the vision planner for TV Compass, an iPhone app for older adults who do not know where TV remote buttons or TV menu items are.",
    "The user has already stated a goal. Inspect the current camera frame first, use OCR only as supplemental evidence, infer the current TV/remote state, then return exactly one next action that is possible from this scene.",
    "This is not a keyword finder. Do not simply look for the goal text on the current screen. Decide whether the user is inside the wrong app, on a content detail page, on a TV home screen, inside search, or looking at the remote.",
    "Do not give a generic multi-step recipe. Only describe the immediate next action.",
    "High visual guidance is the product. If the target button or TV item is visible, return a targetRect so the iPhone can draw a yellow highlight.",
    "Use targetRect only for a real visible object in the attached image. Do not invent a fixed box or ask the user to align the remote to an overlay.",
    "targetRect coordinates are normalized to the attached image: x and y are the top-left corner, width and height are the target box size, all from 0 to 1.",
    "If the remote is visible, identify the relevant button and return a targetRect around the button when it is visible.",
    "If the TV screen is visible, identify the relevant on-screen tile, menu item, input, app, or channel and return targetRect when visible.",
    "If the needed button is not visible because the camera is pointed at the TV, ask the user to show the remote, and set targetButtonKind to the button you need when known.",
    "If the frame is unclear, tell the user how to move the phone: closer, point at the remote, point at the TV screen, or reduce glare.",
    "Use short plain English. Write spokenText as one calm sentence for voice output.",
    "Return only the requested JSON structure.",
    "",
    "State-aware planning examples:",
    "- Goal is Live TV or news live streaming, but the TV image shows HBO, Netflix, YouTube, a show page, or video playback: the next action is usually Home or Back, not searching for the word news on that screen. If the remote is visible, highlight Home or Back. If only the TV is visible, ask to show the remote.",
    "- Goal is a show/movie inside a service, such as Euphoria in HBO. If the TV already shows that service, guide toward Search or the visible title. If the TV is in another app or unrelated screen, guide to Home first, then the service.",
    "- Goal is opening an app. If the app tile is visible on the TV, target that tile and use OK. If the user is inside another app, guide to Home or Back first.",
    "- Goal is complete only when the requested app/channel/content appears open or ready to play.",
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
