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
      targetLabel: "Input",
      targetButtonKind: "input",
      confidence: 0.56,
      needsAnotherFrame: true,
      reason: "Input switching usually starts from the Input or Source button."
    });
  }

  if (texts && target && texts.includes(target)) {
    return response({
      sceneType: "tv",
      action: "move_selection",
      instructionText: `The TV screen shows ${displayTarget(goal)}. Move the highlight there and press OK.`,
      spokenText: `Move the TV highlight to ${displayTarget(goal)}, then press OK.`,
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
      targetLabel: goal.targetApp,
      targetButtonKind: goal.targetApp?.toLowerCase() === "youtube" ? "youtube" : "netflix",
      confidence: 0.52,
      needsAnotherFrame: true,
      reason: "The camera fallback cannot reliably locate app shortcuts without the vision model."
    });
  }

  if (texts.includes("home") || texts.includes("google tv") || texts.includes("apps") || texts.includes("search")) {
    return response({
      sceneType: "tv",
      action: "move_selection",
      instructionText: `On the TV screen, look for ${displayTarget(goal)}. Move the highlight there and press OK.`,
      spokenText: `On the TV screen, move the highlight to ${displayTarget(goal)}, then press OK.`,
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
    targetLabel: nullableString(candidate.targetLabel),
    targetButtonKind: normalizeButtonKind(candidate.targetButtonKind),
    targetRect: normalizeTargetRect(candidate.targetRect),
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    needsAnotherFrame: Boolean(candidate.needsAnotherFrame),
    reason: nullableString(candidate.reason),
    source: "gemini"
  };
}

function response(value: Omit<VisionNextStepResponse, "targetRect" | "source"> & { targetRect?: VisionNextStepResponse["targetRect"] }): VisionNextStepResponse {
  return {
    targetRect: null,
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

  return { x, y, width, height };
}

function boundedNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function displayTarget(input: VisionNextStepInput["goal"]): string {
  return input.targetApp ?? input.targetChannel ?? input.searchQuery ?? input.inputName ?? input.title;
}

function isDirectApp(value: string | null): boolean {
  const text = value?.toLowerCase() ?? "";
  return text === "netflix" || text === "youtube";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
