export type AssistantIntent =
  | "turn_on_tv"
  | "open_app"
  | "open_channel"
  | "search_program"
  | "change_input"
  | "unknown";

export type MemorySnapshot = {
  preferredLanguage: string;
  favoriteApps: string[];
  favoriteChannels: string[];
  lastTargetApp: string | null;
  lastTargetChannel: string | null;
  lastSuccessfulTask: string | null;
  aliases: Record<string, string>;
};

export type MemoryUpdate = {
  key: string;
  value: string;
};

export type AssistantParseInput = {
  userId: string;
  utterance: string;
  recognizedScreenText?: string[];
  recentMemory?: MemorySnapshot;
};

export type AssistantParseResponse = {
  intent: AssistantIntent;
  targetApp: string | null;
  targetChannel: string | null;
  searchQuery: string | null;
  inputName: string | null;
  confidence: number;
  clarificationQuestion: string | null;
  memoryUpdates: MemoryUpdate[];
  source: "gemini" | "fallback";
};

export const defaultMemory = (): MemorySnapshot => ({
  preferredLanguage: "zh-CN",
  favoriteApps: [],
  favoriteChannels: [],
  lastTargetApp: null,
  lastTargetChannel: null,
  lastSuccessfulTask: null,
  aliases: {}
});
