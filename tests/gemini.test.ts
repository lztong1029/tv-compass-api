import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiGenerator, createGeminiVisionGenerator } from "../src/gemini.js";
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
    expect(body.generationConfig.responseJsonSchema.properties.intent.enum).toContain("general_tv_task");
    expect(body.contents[0].parts[0].text).toContain("Generalize");
    expect(body.contents[0].parts[0].text).toContain("volume, mute, captions");
  });

  it("sends camera frames to Gemini vision as inline JPEG data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      sceneType: "remote",
                      action: "press_button",
                      instructionText: "Press Power.",
                      spokenText: "Press the Power button.",
                      targetLabel: "Power",
                      targetButtonKind: "power",
                      targetRect: { x: 0.2, y: 0.1, width: 0.1, height: 0.08 },
                      confidence: 0.82,
                      needsAnotherFrame: true,
                      reason: "Power button is visible."
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

    const generator = createGeminiVisionGenerator("test-key", "gemini-2.5-flash");
    await generator?.(
      {
        userId: "demo",
        goal: {
          intent: "turn_on_tv",
          title: "Turn on TV",
          targetApp: null,
          targetChannel: null,
          searchQuery: null,
          inputName: null
        },
        imageBase64: "abc123"
      },
      defaultMemory()
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(options?.body));
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe("image/jpeg");
    expect(body.contents[0].parts[0].inline_data.data).toBe("abc123");
    expect(body.contents[0].parts[1].text).toContain("This is not a keyword finder");
    expect(body.contents[0].parts[1].text).toContain("The attached image is the primary evidence");
    expect(body.contents[0].parts[1].text).toContain("If the needed button is not visible");
    expect(body.contents[0].parts[1].text).toContain("For general_tv_task goals");
    expect(body.generationConfig.responseJsonSchema.properties.action.enum).toContain("press_button");
    expect(body.generationConfig.responseJsonSchema.properties.currentState.type).toContain("string");
  });

  it("falls back to JSON mode when structured output is rejected", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "bad schema" }), { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        intent: "search_program",
                        targetApp: "HBO",
                        targetChannel: null,
                        searchQuery: "Euphoria",
                        inputName: null,
                        confidence: 0.83,
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
    const result = await generator?.({ userId: "demo", utterance: "watch Euphoria on HBO" }, defaultMemory());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.intent).toBe("search_program");
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.generationConfig.responseMimeType).toBe("application/json");
    expect(secondBody.generationConfig.responseJsonSchema).toBeUndefined();
  });
});
