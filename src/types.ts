export type AssistantIntent =
  | "turn_on_tv"
  | "open_app"
  | "open_channel"
  | "search_program"
  | "change_input"
  | "general_tv_task"
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
  taskDescription?: string | null;
  confidence: number;
  clarificationQuestion: string | null;
  memoryUpdates: MemoryUpdate[];
  source: "gemini" | "fallback";
};

export type GoalDescriptor = {
  intent: AssistantIntent;
  title: string;
  targetApp: string | null;
  targetChannel: string | null;
  searchQuery: string | null;
  inputName: string | null;
  taskDescription?: string | null;
};

export type VisionSceneType = "remote" | "tv" | "unknown";

export type VisionGuideAction =
  | "point_camera"
  | "press_button"
  | "move_selection"
  | "wait"
  | "ask_clarification"
  | "done";

export type VisionTargetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisionNextStepInput = {
  userId: string;
  goal: GoalDescriptor;
  recognizedTexts?: string[];
  imageBase64?: string | null;
  recentMemory?: MemorySnapshot;
};

export type VisionNextStepResponse = {
  sceneType: VisionSceneType;
  action: VisionGuideAction;
  instructionText: string;
  spokenText: string;
  currentState: string | null;
  nextCheckpoint: string | null;
  targetLabel: string | null;
  targetButtonKind: string | null;
  targetRect: VisionTargetRect | null;
  confidence: number;
  needsAnotherFrame: boolean;
  reason: string | null;
  source: "gemini" | "fallback";
};

export const defaultMemory = (): MemorySnapshot => ({
  preferredLanguage: "en-US",
  favoriteApps: [],
  favoriteChannels: [],
  lastTargetApp: null,
  lastTargetChannel: null,
  lastSuccessfulTask: null,
  aliases: {}
});
