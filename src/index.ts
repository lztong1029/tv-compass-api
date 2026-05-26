import { createGeminiGenerator, createGeminiVisionGenerator } from "./gemini.js";
import { InMemoryMemoryRepository, PostgresMemoryRepository } from "./memoryRepository.js";
import { createApp } from "./server.js";

async function main() {
  const port = Number(process.env.PORT ?? 3000);
  const repository = process.env.DATABASE_URL
    ? new PostgresMemoryRepository(process.env.DATABASE_URL)
    : new InMemoryMemoryRepository();
  const gemini = createGeminiGenerator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);
  const visionGemini = createGeminiVisionGenerator(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);

  await repository.init();

  const app = createApp(repository, gemini, visionGemini);
  app.listen(port, () => {
    console.log(`TV Compass API listening on ${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
