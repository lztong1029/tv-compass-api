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
      enum: ["turn_on_tv", "open_app", "open_channel", "search_program", "change_input", "general_tv_task", "unknown"]
    },
    targetApp: { type: ["string", "null"] },
    targetChannel: { type: ["string", "null"] },
    searchQuery: { type: ["string", "null"] },
    inputName: { type: ["string", "null"] },
    taskDescription: { type: ["string", "null"] },
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
    const parts = [{ text: prompt }];
    return requestGeminiJSON<AssistantParseResponse>(apiKey, model, parts, {
      temperature: 0.2,
      schema: structuredResponseSchema,
      errorPrefix: "Gemini request failed"
    });
  };
}

export function createGeminiVisionGenerator(apiKey: string | undefined, model = "gemini-2.5-flash"): GeminiVisionGenerator | null {
  if (!apiKey) {
    return null;
  }

  return async (input, memory) => {
    const prompt = buildVisionPrompt(input, memory);
    const parts: Array<Record<string, unknown>> = [];
    if (input.imageBase64) {
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: input.imageBase64
        }
      });
    }
    parts.push({ text: prompt });

    return requestGeminiJSON<VisionNextStepResponse>(apiKey, model, parts, {
      temperature: 0.1,
      schema: visionResponseSchema,
      errorPrefix: "Gemini vision request failed"
    });
  };
}

async function requestGeminiJSON<T>(
  apiKey: string,
  model: string,
  parts: Array<Record<string, unknown>>,
  options: { temperature: number; schema: Record<string, unknown>; errorPrefix: string }
): Promise<T> {
  try {
    return await postGeminiJSON<T>(apiKey, model, parts, {
      temperature: options.temperature,
      responseMimeType: "application/json",
      responseJsonSchema: options.schema
    }, options.errorPrefix);
  } catch (structuredError) {
    try {
      return await postGeminiJSON<T>(apiKey, model, parts, {
        temperature: options.temperature,
        responseMimeType: "application/json"
      }, options.errorPrefix);
    } catch (looseError) {
      throw new Error(`${options.errorPrefix}: structured=${errorMessage(structuredError)} loose=${errorMessage(looseError)}`);
    }
  }
}

async function postGeminiJSON<T>(
  apiKey: string,
  model: string,
  parts: Array<Record<string, unknown>>,
  generationConfig: Record<string, unknown>,
  errorPrefix: string
): Promise<T> {
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
      generationConfig
    })
  });

  if (!response.ok) {
    throw new Error(`${errorPrefix}: ${response.status}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
  if (!text) {
    throw new Error(`${errorPrefix}: no text`);
  }

  return JSON.parse(text) as T;
}

function buildPrompt(input: AssistantParseInput, memory: MemorySnapshot): string {
  return [
    "You are the language understanding layer for TV Compass, an iPhone camera-first assistant that helps older adults use smart TVs, remotes, streaming apps, live TV, inputs, and TV settings.",
    "Return only the requested JSON structure.",
    "The iPhone app handles camera scanning, OCR, Gemini Vision, and step-by-step instructions. Your job is to convert the user's natural request into a stable goal object that a vision planner can execute from whatever screen or remote is currently visible.",
    "Generalize. Do not return unknown just because the exact app, show, setting, channel, or workflow was not listed in examples.",
    "",
    "Intent mapping:",
    "- turn_on_tv: powering the TV on or waking it.",
    "- open_app: opening any named app/service, including Netflix, YouTube, Max/HBO, Hulu, Disney+, Prime Video, Peacock, Paramount+, Apple TV, ESPN, local TV apps, music apps, photo apps, or browser apps. Put the exact service in targetApp.",
    "- open_channel: opening live TV, antenna/cable, a named broadcast/cable channel, a live news target, a sports channel, or a saved channel inferred from memory. Put the destination in targetChannel.",
    "- search_program: finding, searching, playing, resuming, or opening a specific show, movie, episode, sports event, YouTube video/topic, actor, genre, or content title. Put the title/topic in searchQuery. If the user names a service, also set targetApp.",
    "- change_input: switching source/input/device: HDMI 1/2/3, cable box, game console, Blu-ray, antenna, screen mirroring, AirPlay, Chromecast, or a named connected device. Put the destination in inputName.",
    "- general_tv_task: any TV/remote/settings workflow that is not just opening content: volume, mute, captions/subtitles, audio language, brightness, picture mode, accessibility, Wi-Fi/network, Bluetooth, pairing a remote, login/account, app install/update/delete, sleep timer, parental controls, troubleshooting no signal, finding Settings, navigating menus, or explaining what is on screen. Put a concise executable task in taskDescription.",
    "- unknown: only when the user request is truly too vague to act on, such as 'help me' with no context or memory.",
    "",
    "Disambiguation rules:",
    "- A service name by itself means open_app. A content title or topic means search_program.",
    "- Do not collapse a content request into opening only the app. 'Watch Euphoria on HBO' => search_program, targetApp HBO, searchQuery Euphoria.",
    "- 'News', 'live news', 'local news', 'CNN', 'ESPN live', 'antenna TV', and 'cable' are usually open_channel unless the user names a streaming app as the place to search.",
    "- 'Turn captions on', 'make it louder', 'connect Wi-Fi', 'change picture mode', and 'pair the remote' are general_tv_task, not unknown.",
    "- Use memory for references like yesterday, last time, usual, favorite, my news, or the app I always use. If memory is insufficient but the request is still actionable, classify the task and set a low-to-medium confidence with a clarificationQuestion.",
    "- Preserve the user's named brands, titles, channels, and devices exactly enough for search and display.",
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
    "You are the vision planner for TV Compass, an iPhone app for older adults who do not know where TV remote buttons, menu items, app tiles, inputs, or settings are.",
    "The user has already stated a goal. The attached image is the primary evidence. OCR text is only supplemental and may come from ads, reflections, partial text, or the wrong screen.",
    "Inspect the current camera frame first, infer the current TV/remote state, then return exactly one next action that is possible from this scene.",
    "This is not a keyword finder and not a demo script. Do not simply look for the goal text on the current screen. Decide whether the user is inside the wrong app, on a content detail page, on a TV home screen, in search, in settings, in an input/source menu, watching playback, seeing an error, or looking at the remote.",
    "Do not give a generic multi-step recipe. Only describe the immediate next action.",
    "High visual guidance is the product. If the target button or TV item is visible, return a targetRect so the iPhone can draw a yellow highlight.",
    "Use targetRect only for a real visible object in the attached image. Do not invent a fixed box or ask the user to align the remote to an overlay.",
    "targetRect coordinates are normalized to the attached image: x and y are the top-left corner, width and height are the target box size, all from 0 to 1.",
    "If the remote is visible, identify the relevant button and return a targetRect around the button when it is visible.",
    "If the TV screen is visible, identify the relevant on-screen tile, menu item, input, app, or channel and return targetRect when visible.",
    "If the needed button is not visible because the camera is pointed at the TV, ask the user to show the remote, and set targetButtonKind to the button you need when known.",
    "If the TV appears off, black, asleep, on the wrong input, or no actual TV UI is visible, do not say you cannot read text. The next action is usually to show the remote and press Power or Input.",
    "For general_tv_task goals, reason from normal smart TV navigation: Home, Back, Settings/gear, Input/Source, Search, profile/account, app store, captions/subtitles, audio, display/picture, network/Wi-Fi, accessibility, system, and app menus. Choose the next visible control or ask for the remote if the needed button is physical.",
    "If the frame is unclear, tell the user how to move the phone: closer, point at the remote, point at the TV screen, or reduce glare.",
    "Use short plain English. Write spokenText as one calm sentence for voice output.",
    "Return only the requested JSON structure.",
    "",
    "State-aware planning examples:",
    "- Goal is any live TV or news live streaming, but the TV image shows a streaming app, a show page, an ad, or video playback: the next action is usually Home or Back, not searching for the word news on that screen.",
    "- Goal is a show/movie inside a service. If the screen only shows an ad or another title from the same service, do not treat that as success. Guide toward Search, the exact title, or Home depending on the current state.",
    "- Goal is a show/movie/topic. If the exact requested title/topic is visible, target that title or its Play/Resume button. If only the app/service name is visible, target Search unless the app tile itself is the next needed step.",
    "- Goal is opening any app. If the app tile is visible on the TV, target that tile and use OK. If the user is inside another app, guide to Home or Back first.",
    "- Goal is captions/subtitles/audio language during playback. If playback controls or a captions icon are visible, target them. If not, ask for the remote and use OK, Down, Settings, or a captions button if visible.",
    "- Goal is volume/mute. If the remote is visible, target Volume Up, Volume Down, or Mute. If only TV is visible, ask to show the remote.",
    "- Goal is Wi-Fi/network, Bluetooth, accessibility, picture/audio settings, app install/update, login, or system settings. Guide to Settings/Home first unless the relevant menu is already visible.",
    "- Goal is troubleshooting no signal/wrong device. Prefer Input/Source, then the named input or connected device.",
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
