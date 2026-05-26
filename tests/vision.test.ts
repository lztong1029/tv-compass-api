import { describe, expect, it } from "vitest";
import { defaultMemory, type VisionNextStepInput } from "../src/types.js";
import { fallbackVisionStep, nextVisionStep, validateVisionResponse } from "../src/vision.js";

const liveTVInput = (): VisionNextStepInput => ({
  userId: "demo",
  goal: {
    intent: "open_channel",
    title: "Open Live TV",
    targetApp: null,
    targetChannel: "Live TV",
    searchQuery: null,
    inputName: null
  },
  recognizedTexts: ["Google TV", "Live TV", "Apps"]
});

describe("vision next step", () => {
  it("uses OCR text to guide toward visible TV targets without Gemini", () => {
    const result = fallbackVisionStep(liveTVInput());

    expect(result.source).toBe("fallback");
    expect(result.sceneType).toBe("tv");
    expect(result.action).toBe("move_selection");
    expect(result.targetLabel).toBe("Live TV");
  });

  it("asks for a camera view when no scene data is available", async () => {
    const result = await nextVisionStep(
      {
        userId: "demo",
        goal: {
          intent: "open_app",
          title: "Open Netflix",
          targetApp: "Netflix",
          targetChannel: null,
          searchQuery: null,
          inputName: null
        }
      },
      defaultMemory(),
      null
    );

    expect(result.action).toBe("point_camera");
    expect(result.needsAnotherFrame).toBe(true);
  });

  it("validates Gemini target rectangles", () => {
    const result = validateVisionResponse({
      sceneType: "remote",
      action: "press_button",
      instructionText: "Press Power.",
      spokenText: "Press the Power button.",
      targetLabel: "Power",
      targetButtonKind: "power",
      targetRect: { x: 0.2, y: 0.1, width: 0.12, height: 0.08 },
      confidence: 0.8,
      needsAnotherFrame: true,
      reason: "Power button is visible."
    });

    expect(result?.targetRect?.x).toBe(0.2);
    expect(result?.targetButtonKind).toBe("power");
  });

  it("rejects malformed Gemini vision output", () => {
    const result = validateVisionResponse({
      sceneType: "remote",
      action: "press_button",
      instructionText: "Press Power.",
      confidence: "high"
    });

    expect(result).toBeNull();
  });
});
