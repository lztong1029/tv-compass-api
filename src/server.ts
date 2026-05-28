import cors from "cors";
import express from "express";
import type { GeminiGenerator, GeminiVisionGenerator } from "./gemini.js";
import { parseAssistantRequest, updatedMemoryAfterParse } from "./assistant.js";
import { normalizeMemory, type MemoryRepository } from "./memoryRepository.js";
import { nextVisionStep } from "./vision.js";
import { defaultMemory, type AssistantParseInput, type GoalDescriptor, type VisionNextStepInput } from "./types.js";

export function createApp(repository: MemoryRepository, gemini: GeminiGenerator | null, visionGemini: GeminiVisionGenerator | null = null) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "tv-compass-api",
      version: "2026-05-27.2",
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
    });
  });

  app.post("/v1/assistant/parse", async (request, response, next) => {
    try {
      const input = normalizeAssistantInput(request.body);
      if (!input) {
        response.status(400).json({ error: "userId and utterance are required" });
        return;
      }

      const memory = input.recentMemory ? normalizeMemory(input.recentMemory) : await repository.get(input.userId);
      const parsed = await parseAssistantRequest(input, memory, gemini);
      const nextMemory = updatedMemoryAfterParse(memory, parsed);
      await repository.save(input.userId, nextMemory);
      response.json(parsed);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/vision/next-step", async (request, response, next) => {
    try {
      const input = normalizeVisionInput(request.body);
      if (!input) {
        response.status(400).json({ error: "userId and goal are required" });
        return;
      }

      const memory = input.recentMemory ? normalizeMemory(input.recentMemory) : await repository.get(input.userId);
      response.json(await nextVisionStep(input, memory, visionGemini));
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/memory/:userId", async (request, response, next) => {
    try {
      response.json(await repository.get(request.params.userId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/memory/:userId", async (request, response, next) => {
    try {
      const memory = normalizeMemory(request.body ?? defaultMemory());
      response.json(await repository.save(request.params.userId, memory));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/memory/:userId", async (request, response, next) => {
    try {
      await repository.clear(request.params.userId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });

  return app;
}

function normalizeAssistantInput(value: unknown): AssistantParseInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const body = value as Record<string, unknown>;
  if (typeof body.userId !== "string" || !body.userId.trim()) {
    return null;
  }
  if (typeof body.utterance !== "string" || !body.utterance.trim()) {
    return null;
  }

  return {
    userId: body.userId.trim(),
    utterance: body.utterance.trim(),
    recognizedScreenText: Array.isArray(body.recognizedScreenText)
      ? body.recognizedScreenText.filter((item): item is string => typeof item === "string")
      : undefined,
    recentMemory:
      body.recentMemory && typeof body.recentMemory === "object"
        ? normalizeMemory(body.recentMemory as Partial<ReturnType<typeof defaultMemory>>)
        : undefined
  };
}

function normalizeVisionInput(value: unknown): VisionNextStepInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const body = value as Record<string, unknown>;
  if (typeof body.userId !== "string" || !body.userId.trim()) {
    return null;
  }

  const goal = normalizeGoalDescriptor(body.goal);
  if (!goal) {
    return null;
  }

  return {
    userId: body.userId.trim(),
    goal,
    recognizedTexts: Array.isArray(body.recognizedTexts)
      ? body.recognizedTexts.filter((item): item is string => typeof item === "string")
      : undefined,
    imageBase64: typeof body.imageBase64 === "string" && body.imageBase64.trim() ? body.imageBase64.trim() : null,
    recentMemory:
      body.recentMemory && typeof body.recentMemory === "object"
        ? normalizeMemory(body.recentMemory as Partial<ReturnType<typeof defaultMemory>>)
        : undefined
  };
}

function normalizeGoalDescriptor(value: unknown): GoalDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const body = value as Record<string, unknown>;
  if (typeof body.intent !== "string" || typeof body.title !== "string" || !body.title.trim()) {
    return null;
  }

  return {
    intent: body.intent as GoalDescriptor["intent"],
    title: body.title.trim(),
    targetApp: nullableString(body.targetApp),
    targetChannel: nullableString(body.targetChannel),
    searchQuery: nullableString(body.searchQuery),
    inputName: nullableString(body.inputName),
    taskDescription: nullableString(body.taskDescription)
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
