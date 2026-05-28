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

  it("does not collapse content requests into app-only requests", async () => {
    const result = await parseAssistantRequest(
      {
        userId: "demo",
        utterance: "I want to watch Euphoria on HBO"
      },
      defaultMemory(),
      null
    );

    expect(result.source).toBe("fallback");
    expect(result.intent).toBe("search_program");
    expect(result.targetApp).toBe("HBO");
    expect(result.searchQuery).toBe("Euphoria");
  });

  it("maps everyday TV workflows to a general task instead of unknown", async () => {
    const result = await parseAssistantRequest(
      {
        userId: "demo",
        utterance: "turn on captions for this show"
      },
      defaultMemory(),
      null
    );

    expect(result.source).toBe("fallback");
    expect(result.intent).toBe("general_tv_task");
    expect(result.taskDescription?.toLowerCase()).toContain("caption");
  });

  it("rejects malformed gemini output", () => {
    const result = validateAssistantResponse({
      intent: "open_app",
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

  it("accepts generalized Gemini TV task output", () => {
    const result = validateAssistantResponse({
      intent: "general_tv_task",
      taskDescription: "Turn on captions for the current show",
      confidence: 0.82,
      memoryUpdates: []
    });

    expect(result?.intent).toBe("general_tv_task");
    expect(result?.taskDescription).toContain("captions");
  });

  it("accepts looser Gemini JSON with snake_case fields", () => {
    const result = validateAssistantResponse({
      intent: "general_task",
      task_description: "connect the TV to Wi-Fi",
      memory_updates: []
    });

    expect(result?.intent).toBe("general_tv_task");
    expect(result?.taskDescription).toBe("connect the TV to Wi-Fi");
    expect(result?.confidence).toBeGreaterThan(0.5);
  });
});
