import type { AssistantParseResponse, MemorySnapshot } from "./types.js";

const baseResponse = (): AssistantParseResponse => ({
  intent: "unknown",
  targetApp: null,
  targetChannel: null,
  searchQuery: null,
  inputName: null,
  confidence: 0,
  clarificationQuestion: "I can help with turning on the TV, opening Netflix or YouTube, and finding a saved news channel.",
  memoryUpdates: [],
  source: "fallback"
});

export function parseWithLocalFallback(utterance: string, memory: MemorySnapshot): AssistantParseResponse {
  const text = utterance.trim().toLowerCase();
  const response = baseResponse();

  if (!text) {
    return response;
  }

  if (text.includes("开电视") || text.includes("打开电视") || text.includes("turn on") || text.includes("power on")) {
    return {
      ...response,
      intent: "turn_on_tv",
      confidence: 0.8,
      clarificationQuestion: null
    };
  }

  if (text.includes("netflix") || text.includes("奈飞")) {
    return {
      ...response,
      intent: "open_app",
      targetApp: "Netflix",
      confidence: 0.9,
      clarificationQuestion: null,
      memoryUpdates: [{ key: "lastTargetApp", value: "Netflix" }]
    };
  }

  if (text.includes("youtube") || text.includes("油管")) {
    return {
      ...response,
      intent: "open_app",
      targetApp: "YouTube",
      confidence: 0.9,
      clarificationQuestion: null,
      memoryUpdates: [{ key: "lastTargetApp", value: "YouTube" }]
    };
  }

  if (text.includes("昨天") || text.includes("last") || text.includes("新闻台") || text.includes("news channel")) {
    const targetChannel = memory.lastTargetChannel ?? memory.favoriteChannels[0] ?? null;
    if (targetChannel) {
      return {
        ...response,
        intent: "open_channel",
        targetChannel,
        confidence: 0.72,
        clarificationQuestion: null
      };
    }

    return {
      ...response,
      intent: "search_program",
      searchQuery: "news",
      confidence: 0.58,
      clarificationQuestion: null
    };
  }

  if (text.includes("经常看的") || text.includes("平时看的") || text.includes("favorite")) {
    const targetApp = memory.lastTargetApp ?? memory.favoriteApps[0] ?? null;
    if (targetApp) {
      return {
        ...response,
        intent: "open_app",
        targetApp,
        confidence: 0.7,
        clarificationQuestion: null
      };
    }
  }

  if (text.includes("hdmi")) {
    return {
      ...response,
      intent: "change_input",
      inputName: "HDMI",
      confidence: 0.7,
      clarificationQuestion: null
    };
  }

  if (text.includes("搜索") || text.includes("search") || text.includes("找")) {
    const query = text
      .replaceAll("搜索", "")
      .replaceAll("search", "")
      .replaceAll("找", "")
      .trim();

    if (query) {
      return {
        ...response,
        intent: "search_program",
        searchQuery: query,
        confidence: 0.65,
        clarificationQuestion: null
      };
    }
  }

  return response;
}
