import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiGenerator } from "../src/gemini.js";
import { defaultMemory } from "../src/types.js";

describe("gemini generator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Gemini REST structured output fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      intent: "open_app",
                      targetApp: "Netflix",
                      targetChannel: null,
                      searchQuery: null,
                      inputName: null,
                      confidence: 0.9,
                      clarificationQuestion: null,
                      memoryUpdates: []
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const generator = createGeminiGenerator("test-key", "gemini-2.5-flash");
    await generator?.({ userId: "demo", utterance: "打开 Netflix" }, defaultMemory());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect((options?.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");

    const body = JSON.parse(String(options?.body));
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema.properties.intent.enum).toContain("open_app");
  });
});
