import type { AssistantParseResponse, MemorySnapshot } from "./types.js";

const baseResponse = (): AssistantParseResponse => ({
  intent: "unknown",
  targetApp: null,
  targetChannel: null,
  searchQuery: null,
  inputName: null,
  confidence: 0,
  clarificationQuestion: "Tell me what you want to watch, or name the app, channel, input, or program.",
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

  const appName = knownStreamingApp(text) ?? genericWatchTarget(text);
  if (appName) {
    return {
      ...response,
      intent: "open_app",
      targetApp: appName,
      confidence: 0.74,
      clarificationQuestion: null,
      memoryUpdates: [{ key: "lastTargetApp", value: appName }]
    };
  }

  if (text.includes("live tv") || text.includes("live television") || text.includes("antenna") || text.includes("cable tv") || text.includes("电视直播")) {
    return {
      ...response,
      intent: "open_channel",
      targetChannel: "Live TV",
      confidence: 0.82,
      clarificationQuestion: null,
      memoryUpdates: [{ key: "lastTargetChannel", value: "Live TV" }]
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

function knownStreamingApp(text: string): string | null {
  const aliases: Array<[string, string]> = [
    ["hbo max", "Max"],
    ["hbo", "HBO"],
    ["max", "Max"],
    ["disney plus", "Disney+"],
    ["disney+", "Disney+"],
    ["disney", "Disney+"],
    ["hulu", "Hulu"],
    ["prime video", "Prime Video"],
    ["amazon prime", "Prime Video"],
    ["peacock", "Peacock"],
    ["paramount", "Paramount+"],
    ["apple tv", "Apple TV"],
    ["espn", "ESPN"],
    ["roku channel", "Roku Channel"],
    ["tubi", "Tubi"],
    ["pluto", "Pluto TV"]
  ];

  return aliases.find(([needle]) => text.includes(needle))?.[1] ?? null;
}

function genericWatchTarget(text: string): string | null {
  const prefixes = [
    "i want to watch",
    "i want to see",
    "i want to open",
    "watch",
    "open",
    "launch",
    "start",
    "打开",
    "看"
  ];

  for (const prefix of prefixes) {
    if (!text.startsWith(prefix)) continue;
    const candidate = text.slice(prefix.length).trim();
    if (candidate.length >= 2 && !candidate.includes("tv")) {
      return titleCase(candidate);
    }
  }

  return null;
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/^[a-z]{2,4}$/.test(word) ? word.toUpperCase() : word.slice(0, 1).toUpperCase() + word.slice(1)))
    .join(" ");
}
