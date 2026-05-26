import { describe, expect, it } from "vitest";
import { applyMemoryUpdates, InMemoryMemoryRepository } from "../src/memoryRepository.js";
import { defaultMemory } from "../src/types.js";

describe("memory repository", () => {
  it("stores memory by anonymous user id", async () => {
    const repository = new InMemoryMemoryRepository();
    await repository.init();

    const memory = await repository.save("user-1", {
      ...defaultMemory(),
      lastTargetChannel: "CCTV News"
    });

    expect(memory.lastTargetChannel).toBe("CCTV News");
    expect((await repository.get("user-1")).lastTargetChannel).toBe("CCTV News");
    expect((await repository.get("user-2")).lastTargetChannel).toBeNull();
  });

  it("summarizes memory updates without raw transcripts", () => {
    const next = applyMemoryUpdates(defaultMemory(), [
      { key: "lastTargetApp", value: "Netflix" },
      { key: "lastTargetChannel", value: "CNN" }
    ]);

    expect(next.lastTargetApp).toBe("Netflix");
    expect(next.favoriteApps).toContain("Netflix");
    expect(next.lastTargetChannel).toBe("CNN");
    expect(next.favoriteChannels).toContain("CNN");
  });
});
