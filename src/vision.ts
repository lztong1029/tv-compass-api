import { createGeminiVisionGenerator, type GeminiVisionGenerator } from "./gemini.js";
import { defaultMemory, type VisionGuideAction, type VisionNextStepInput, type VisionNextStepResponse, type VisionSceneType } from "./types.js";
import type { MemorySnapshot } from "./types.js";

const sceneTypes = new Set<VisionSceneType>(["remote", "tv", "unknown"]);
const actions = new Set<VisionGuideAction>([
  "point_camera",
  "press_button",
  "move_selection",
  "wait",
  "ask_clarification",
  "done"
]);
const buttonKinds = new Set([
  "power",
  "home",
  "back",
  "ok",
  "up",
  "down",
  "left",
  "right",
  "volumeUp",
  "volumeDown",
  "input",
  "netflix",
  "youtube",
  "mute",
  "settings"
]);

export async function nextVisionStep(
  input: VisionNextStepInput,
  memory: MemorySnapshot = defaultMemory(),
  gemini: GeminiVisionGenerator | null = createGeminiVisionGenerator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL)
): Promise<VisionNextStepResponse> {
  if (gemini) {
    try {
      const raw = await gemini(input, memory);
      const parsed = validateVisionResponse(raw);
      if (parsed) {
        return { ...parsed, source: "gemini" };
      }
    } catch (error) {
      console.warn(`Gemini vision failed; using local fallback. ${errorMessage(error)}`);
    }
  }

  return fallbackVisionStep(input);
}

export function fallbackVisionStep(input: VisionNextStepInput): VisionNextStepResponse {
  const texts = (input.recognizedTexts ?? []).join(" ").toLowerCase();
  const goal = input.goal;
  const target = (goal.targetApp ?? goal.targetChannel ?? goal.searchQuery ?? goal.inputName ?? goal.title).toLowerCase();

  if (!input.imageBase64 && !texts) {
    return response({
      sceneType: "unknown",
      action: "point_camera",
      instructionText: "Point the camera at the remote or the TV screen.",
      spokenText: "Point the camera at the remote or the TV screen, then tap Analyze View.",
      currentState: "No usable camera frame or OCR text was available.",
      nextCheckpoint: "remote or TV screen visible",
      targetLabel: null,
      targetButtonKind: null,
      confidence: 0.35,
      needsAnotherFrame: true,
      reason: "No camera frame or OCR text was provided."
    });
  }

  if (goal.intent === "turn_on_tv") {
    return response({
      sceneType: "remote",
      action: "press_button",
      instructionText: "Show the top of the remote and press Power.",
      spokenText: "Point the camera at the top of the remote. Press the Power button.",
      currentState: "The goal is to power on the TV.",
      nextCheckpoint: "TV screen turns on",
      targetLabel: "Power",
      targetButtonKind: "power",
      confidence: 0.56,
      needsAnotherFrame: true,
      reason: "Local fallback knows the power action but cannot locate the exact button without Gemini vision."
    });
  }

  if (goal.intent === "change_input") {
    return response({
      sceneType: "remote",
      action: "press_button",
      instructionText: `Press Input, then choose ${goal.inputName ?? "the correct input"} on the TV.`,
      spokenText: "Point the camera at the remote and press the Input button.",
      currentState: "Input switching starts from the remote on most TVs.",
      nextCheckpoint: "input/source menu visible",
      targetLabel: "Input",
      targetButtonKind: "input",
      confidence: 0.56,
      needsAnotherFrame: true,
      reason: "Input switching usually starts from the Input or Source button."
    });
  }

  if (goal.intent === "general_tv_task") {
    const task = goal.taskDescription ?? goal.title;
    const targetButton = generalTaskButton(task);
    if (targetButton) {
      return response({
        sceneType: "remote",
        action: "press_button",
        instructionText: `Show the remote and press ${buttonLabel(targetButton)}.`,
        spokenText: `Show me the remote and press ${buttonLabel(targetButton)}.`,
        currentState: `The goal is: ${task}.`,
        nextCheckpoint: "TV responds to the remote button",
        targetLabel: buttonLabel(targetButton),
        targetButtonKind: targetButton,
        confidence: 0.52,
        needsAnotherFrame: true,
        reason: "Local fallback maps this general task to a common remote button."
      });
    }

    return response({
      sceneType: "unknown",
      action: "point_camera",
      instructionText: `Show the TV screen or remote so I can guide: ${task}.`,
      spokenText: "Show me the TV screen or remote so I can guide the next step.",
      currentState: "The goal is a general TV task.",
      nextCheckpoint: "relevant menu or remote button visible",
      targetLabel: "Settings",
      targetButtonKind: null,
      confidence: 0.42,
      needsAnotherFrame: true,
      reason: "General TV tasks depend on the visible current screen."
    });
  }

  if (goal.intent === "open_channel" && isLiveTVGoal(goal) && looksLikeInsideStreamingApp(texts)) {
    return response({
      sceneType: "remote",
      action: "press_button",
      instructionText: "This looks like a streaming app. Show the remote and press Home to leave it.",
      spokenText: "This looks like a streaming app. Show me the remote and press Home.",
      currentState: "The TV appears to be inside a streaming app or show page.",
      nextCheckpoint: "TV home screen or live TV area",
      targetLabel: "Home",
      targetButtonKind: "home",
      confidence: 0.58,
      needsAnotherFrame: true,
      reason: "Live TV/news usually requires leaving the current app before selecting the live TV area."
    });
  }

  if (goal.intent === "search_program" && goal.targetApp && looksLikeInsideDifferentApp(texts, goal.targetApp)) {
    return response({
      sceneType: "remote",
      action: "press_button",
      instructionText: `This is not ${goal.targetApp}. Show the remote and press Home first.`,
      spokenText: `This does not look like ${goal.targetApp}. Show me the remote and press Home first.`,
      currentState: "The TV appears to be inside a different app or content page.",
      nextCheckpoint: `${goal.targetApp} app tile or search`,
      targetLabel: "Home",
      targetButtonKind: "home",
      confidence: 0.56,
      needsAnotherFrame: true,
      reason: "The requested content belongs to a specific service, but the current screen does not look like that service."
    });
  }

  if (goal.intent === "search_program" && goal.targetApp && texts.includes(goal.targetApp.toLowerCase()) && !texts.includes((goal.searchQuery ?? "").toLowerCase())) {
    return response({
      sceneType: "tv",
      action: "move_selection",
      instructionText: `I can see ${goal.targetApp}, but not ${goal.searchQuery ?? displayTarget(goal)}. Find Search instead of selecting this screen.`,
      spokenText: `I can see ${goal.targetApp}, but not ${goal.searchQuery ?? displayTarget(goal)}. Find Search instead.`,
      currentState: `The TV appears to be in ${goal.targetApp}.`,
      nextCheckpoint: "search field visible",
      targetLabel: "Search",
      targetButtonKind: "ok",
      confidence: 0.55,
      needsAnotherFrame: true,
      reason: "The app is visible but the requested title is not visible yet."
    });
  }

  if (texts && target && texts.includes(target)) {
    return response({
      sceneType: "tv",
      action: "move_selection",
      instructionText: `The TV screen shows ${displayTarget(goal)}. Move the highlight there and press OK.`,
      spokenText: `Move the TV highlight to ${displayTarget(goal)}, then press OK.`,
      currentState: "The requested target appears in the visible TV text.",
      nextCheckpoint: `${displayTarget(goal)} opens`,
      targetLabel: displayTarget(goal),
      targetButtonKind: "ok",
      confidence: 0.62,
      needsAnotherFrame: true,
      reason: "The requested target appears in OCR text."
    });
  }

  if (goal.intent === "open_app" && isDirectApp(goal.targetApp)) {
    return response({
      sceneType: "remote",
      action: "press_button",
      instructionText: `If your remote has a ${goal.targetApp} button, point the camera at it and press it.`,
      spokenText: `Point the camera at your remote. If you see the ${goal.targetApp} button, press it.`,
      currentState: "The requested app may have a physical remote shortcut.",
      nextCheckpoint: `${goal.targetApp} opens`,
      targetLabel: goal.targetApp,
      targetButtonKind: goal.targetApp?.toLowerCase() === "youtube" ? "youtube" : "netflix",
      confidence: 0.52,
      needsAnotherFrame: true,
      reason: "The camera fallback cannot reliably locate app shortcuts without the vision model."
    });
  }

  if (goal.intent === "search_program" && texts.includes("search")) {
    return response({
      sceneType: "tv",
      action: "move_selection",
      instructionText: `The TV shows Search. Select it and search for ${goal.searchQuery ?? displayTarget(goal)}.`,
      spokenText: `Select Search, then search for ${goal.searchQuery ?? displayTarget(goal)}.`,
      currentState: "A search entry point is visible on the TV.",
      nextCheckpoint: `${goal.searchQuery ?? displayTarget(goal)} search results`,
      targetLabel: "Search",
      targetButtonKind: "ok",
      confidence: 0.58,
      needsAnotherFrame: true,
      reason: "Search is visible, which is the next useful step for a title request."
    });
  }

  if (texts.includes("home") || texts.includes("google tv") || texts.includes("apps") || texts.includes("search")) {
    return response({
      sceneType: "tv",
      action: "move_selection",
      instructionText: `On the TV screen, look for ${displayTarget(goal)}. Move the highlight there and press OK.`,
      spokenText: `On the TV screen, move the highlight to ${displayTarget(goal)}, then press OK.`,
      currentState: "The visible TV text looks like a home or app navigation screen.",
      nextCheckpoint: `${displayTarget(goal)} selected`,
      targetLabel: displayTarget(goal),
      targetButtonKind: "ok",
      confidence: 0.55,
      needsAnotherFrame: true,
      reason: "The OCR text looks like a TV home screen."
    });
  }

  return response({
    sceneType: "unknown",
    action: "point_camera",
    instructionText: `Point the camera at the TV screen so I can find ${displayTarget(goal)}.`,
    spokenText: `Point the camera at the TV screen so I can find ${displayTarget(goal)}.`,
    currentState: "The local fallback cannot infer the current TV state.",
    nextCheckpoint: `${displayTarget(goal)} visible or remote visible`,
    targetLabel: displayTarget(goal),
    targetButtonKind: null,
    confidence: 0.42,
    needsAnotherFrame: true,
    reason: "Local fallback needs a clearer TV screen or remote view."
  });
}

export function validateVisionResponse(value: unknown): VisionNextStepResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<VisionNextStepResponse>;
  if (!candidate.sceneType || !sceneTypes.has(candidate.sceneType)) {
    return null;
  }
  if (!candidate.action || !actions.has(candidate.action)) {
    return null;
  }
  if (typeof candidate.instructionText !== "string" || !candidate.instructionText.trim()) {
    return null;
  }
  if (typeof candidate.spokenText !== "string" || !candidate.spokenText.trim()) {
    return null;
  }
  if (typeof candidate.confidence !== "number") {
    return null;
  }

  return {
    sceneType: candidate.sceneType,
    action: candidate.action,
    instructionText: candidate.instructionText.trim(),
    spokenText: candidate.spokenText.trim(),
    currentState: nullableString(candidate.currentState),
    nextCheckpoint: nullableString(candidate.nextCheckpoint),
    targetLabel: nullableString(candidate.targetLabel),
    targetButtonKind: normalizeButtonKind(candidate.targetButtonKind),
    targetRect: normalizeTargetRect(candidate.targetRect),
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    needsAnotherFrame: Boolean(candidate.needsAnotherFrame),
    reason: nullableString(candidate.reason),
    source: "gemini"
  };
}

function response(
  value: Omit<VisionNextStepResponse, "targetRect" | "source" | "currentState" | "nextCheckpoint"> & {
    targetRect?: VisionNextStepResponse["targetRect"];
    currentState?: string | null;
    nextCheckpoint?: string | null;
  }
): VisionNextStepResponse {
  return {
    targetRect: null,
    currentState: null,
    nextCheckpoint: null,
    source: "fallback",
    ...value
  };
}

function normalizeButtonKind(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return buttonKinds.has(value) ? value : null;
}

function normalizeTargetRect(value: unknown): VisionNextStepResponse["targetRect"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rect = value as Record<string, unknown>;
  const x = boundedNumber(rect.x);
  const y = boundedNumber(rect.y);
  const width = boundedNumber(rect.width);
  const height = boundedNumber(rect.height);
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  const clampedWidth = Math.min(width, 1 - x);
  const clampedHeight = Math.min(height, 1 - y);
  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return { x, y, width: clampedWidth, height: clampedHeight };
}

function boundedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function displayTarget(input: VisionNextStepInput["goal"]): string {
  return input.targetApp ?? input.targetChannel ?? input.searchQuery ?? input.inputName ?? input.taskDescription ?? input.title;
}

function isDirectApp(value: string | null): boolean {
  const text = value?.toLowerCase() ?? "";
  return text === "netflix" || text === "youtube";
}

function isLiveTVGoal(goal: VisionNextStepInput["goal"]): boolean {
  const target = `${goal.targetChannel ?? ""} ${goal.searchQuery ?? ""} ${goal.title}`.toLowerCase();
  return target.includes("live") || target.includes("news") || target.includes("antenna") || target.includes("cable");
}

function looksLikeInsideStreamingApp(texts: string): boolean {
  return [
    "hbo",
    "max",
    "netflix",
    "youtube",
    "hulu",
    "disney",
    "prime video",
    "peacock",
    "paramount",
    "euphoria",
    "episode",
    "season",
    "resume",
    "play"
  ].some((needle) => texts.includes(needle));
}

function looksLikeInsideDifferentApp(texts: string, targetApp: string): boolean {
  const target = targetApp.toLowerCase();
  if (!texts || texts.includes(target)) {
    return false;
  }
  return looksLikeInsideStreamingApp(texts);
}

function generalTaskButton(task: string): string | null {
  const text = task.toLowerCase();
  if (text.includes("volume") || text.includes("louder")) return "volumeUp";
  if (text.includes("quieter")) return "volumeDown";
  if (text.includes("mute")) return "mute";
  if (text.includes("input") || text.includes("source") || text.includes("signal")) return "input";
  if (text.includes("setting") || text.includes("caption") || text.includes("subtitle") || text.includes("wifi") || text.includes("network")) return "settings";
  return null;
}

function buttonLabel(kind: string): string {
  const labels: Record<string, string> = {
    volumeUp: "Volume +",
    volumeDown: "Volume -",
    mute: "Mute",
    input: "Input",
    settings: "Settings"
  };
  return labels[kind] ?? kind;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
