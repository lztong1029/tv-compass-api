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

  const candidate = value as Partial<AssistantParseResponse> & Record<string, unknown>;
  const intent = normalizeIntent(candidate.intent);
  if (!intent || !intents.has(intent)) {
    return null;
  }

  const targetApp = nullableString(candidate.targetApp ?? candidate.target_app);
  const targetChannel = nullableString(candidate.targetChannel ?? candidate.target_channel);
  const searchQuery = nullableString(candidate.searchQuery ?? candidate.search_query);
  const inputName = nullableString(candidate.inputName ?? candidate.input_name);
  const taskDescription = nullableString(candidate.taskDescription ?? candidate.task_description ?? candidate.description);
  const confidence = normalizeConfidence(candidate.confidence, intent, {
    targetApp,
    targetChannel,
    searchQuery,
    inputName,
    taskDescription
  });
  if (confidence === null) {
    return null;
  }

  return {
    intent,
    targetApp,
    targetChannel,
    searchQuery,
    inputName,
    taskDescription,
    confidence,
    clarificationQuestion: nullableString(candidate.clarificationQuestion ?? candidate.clarification_question),
    memoryUpdates: normalizeMemoryUpdates(candidate.memoryUpdates ?? candidate.memory_updates),
    source: "gemini"
  };
}

function normalizeIntent(value: unknown): AssistantIntent | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  const aliases: Record<string, AssistantIntent> = {
    turnontv: "turn_on_tv",
    turn_on: "turn_on_tv",
    power_on: "turn_on_tv",
    openapp: "open_app",
    open_service: "open_app",
    openchannel: "open_channel",
    live_tv: "open_channel",
    searchprogram: "search_program",
    search_content: "search_program",
    watch_content: "search_program",
    changeinput: "change_input",
    switch_input: "change_input",
    general_task: "general_tv_task",
    general: "general_tv_task",
    tv_task: "general_tv_task",
    settings_task: "general_tv_task"
  };

  return (intents.has(normalized as AssistantIntent) ? normalized : aliases[normalized]) as AssistantIntent | null;
}

function normalizeConfidence(
  value: unknown,
  intent: AssistantIntent,
  fields: { targetApp: string | null; targetChannel: string | null; searchQuery: string | null; inputName: string | null; taskDescription: string | null }
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }

  switch (intent) {
    case "turn_on_tv":
      return 0.72;
    case "open_app":
      return fields.targetApp ? 0.72 : null;
    case "open_channel":
      return fields.targetChannel ? 0.72 : null;
    case "search_program":
      return fields.searchQuery ? 0.72 : null;
    case "change_input":
      return fields.inputName ? 0.72 : null;
    case "general_tv_task":
      return fields.taskDescription ? 0.68 : null;
    case "unknown":
      return 0.3;
  }
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
