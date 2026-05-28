import { createGeminiGenerator, type GeminiGenerator } from "./gemini.js";
import { parseWithLocalFallback } from "./localFallback.js";
import { applyMemoryUpdates } from "./memoryRepository.js";
import { defaultMemory, type AssistantIntent, type AssistantParseInput, type AssistantParseResponse, type MemorySnapshot } from "./types.js";

const intents = new Set<AssistantIntent>([
  "turn_on_tv",
  "open_app",
  "open_channel",
  "search_program",
  "change_input",
  "general_tv_task",
  "unknown"
]);

export async function parseAssistantRequest(
  input: AssistantParseInput,
  memory: MemorySnapshot = defaultMemory(),
  gemini: GeminiGenerator | null = createGeminiGenerator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL)
): Promise<AssistantParseResponse> {
  if (gemini) {
    try {
      const raw = await gemini(input, memory);
      const parsed = validateAssistantResponse(raw);
      if (parsed) {
        return { ...parsed, source: "gemini" };
      }
    } catch (error) {
      console.warn(`Gemini parse failed; using local fallback. ${errorMessage(error)}`);
    }
  }

  return parseWithLocalFallback(input.utterance, memory);
}

export function updatedMemoryAfterParse(memory: MemorySnapshot, response: AssistantParseResponse): MemorySnapshot {
  const derivedUpdates = [...response.memoryUpdates];

  if (response.intent === "open_app" && response.targetApp) {
    derivedUpdates.push({ key: "lastTargetApp", value: response.targetApp });
  }

  if (response.intent === "search_program" && response.targetApp) {
    derivedUpdates.push({ key: "lastTargetApp", value: response.targetApp });
  }

  if (response.intent === "open_channel" && response.targetChannel) {
    derivedUpdates.push({ key: "lastTargetChannel", value: response.targetChannel });
  }

  if (response.intent === "general_tv_task" && response.taskDescription) {
    derivedUpdates.push({ key: "lastSuccessfulTask", value: response.taskDescription });
  }

  return applyMemoryUpdates(memory, derivedUpdates);
}

export function validateAssistantResponse(value: unknown): AssistantParseResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AssistantParseResponse>;
  if (!candidate.intent || !intents.has(candidate.intent)) {
    return null;
  }

  const confidence = typeof candidate.confidence === "number" ? Math.max(0, Math.min(1, candidate.confidence)) : null;
  if (confidence === null) {
    return null;
  }

  return {
    intent: candidate.intent,
    targetApp: nullableString(candidate.targetApp),
    targetChannel: nullableString(candidate.targetChannel),
    searchQuery: nullableString(candidate.searchQuery),
    inputName: nullableString(candidate.inputName),
    taskDescription: nullableString(candidate.taskDescription),
    confidence,
    clarificationQuestion: nullableString(candidate.clarificationQuestion),
    memoryUpdates: normalizeMemoryUpdates(candidate.memoryUpdates),
    source: "gemini"
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMemoryUpdates(value: unknown): { key: string; value: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const entry = item as { key?: unknown; value?: unknown };
      if (typeof entry.key !== "string" || typeof entry.value !== "string") return null;
      return { key: entry.key.trim(), value: entry.value.trim() };
    })
    .filter((item): item is { key: string; value: string } => Boolean(item?.key && item?.value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
