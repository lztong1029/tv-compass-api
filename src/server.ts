import cors from "cors";
import express from "express";
import type { GeminiGenerator } from "./gemini.js";
import { parseAssistantRequest, updatedMemoryAfterParse } from "./assistant.js";
import { normalizeMemory, type MemoryRepository } from "./memoryRepository.js";
import { defaultMemory, type AssistantParseInput } from "./types.js";

export function createApp(repository: MemoryRepository, gemini: GeminiGenerator | null) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "tv-compass-api" });
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
