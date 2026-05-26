import { describe, expect, it } from "vitest";
import { parseAssistantRequest, validateAssistantResponse } from "../src/assistant.js";
import { defaultMemory, type AssistantParseInput } from "../src/types.js";

describe("assistant parser", () => {
  it("falls back to local parser when gemini is unavailable", async () => {
    const input: AssistantParseInput = {
      userId: "demo",
      utterance: "打开 Netflix"
    };

    const result = await parseAssistantRequest(input, defaultMemory(), null);

    expect(result.source).toBe("fallback");
    expect(result.intent).toBe("open_app");
    expect(result.targetApp).toBe("Netflix");
  });

  it("understands live TV through local fallback", async () => {
    const result = await parseAssistantRequest(
      {
        userId: "demo",
        utterance: "i want to see live TV instead of apps"
      },
      defaultMemory(),
      null
    );

    expect(result.source).toBe("fallback");
    expect(result.intent).toBe("open_channel");
    expect(result.targetChannel).toBe("Live TV");
  });

  it("understands non-demo streaming apps through local fallback", async () => {
    const result = await parseAssistantRequest(
      {
        userId: "demo",
        utterance: "I want to see HBO"
      },
      defaultMemory(),
      null
    );

    expect(result.source).toBe("fallback");
    expect(result.intent).toBe("open_app");
    expect(result.targetApp).toBe("HBO");
  });

  it("rejects malformed gemini output", () => {
    const result = validateAssistantResponse({
      intent: "open_app",
      targetApp: "Netflix",
      confidence: "high",
      memoryUpdates: []
    });

    expect(result).toBeNull();
  });

  it("accepts valid structured gemini output", () => {
    const result = validateAssistantResponse({
      intent: "open_channel",
      targetChannel: "CNN",
      confidence: 0.76,
      memoryUpdates: [{ key: "lastTargetChannel", value: "CNN" }]
    });

    expect(result?.intent).toBe("open_channel");
    expect(result?.targetChannel).toBe("CNN");
  });
});
