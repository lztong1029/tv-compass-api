import pg from "pg";
import { defaultMemory, type MemorySnapshot } from "./types.js";

export interface MemoryRepository {
  init(): Promise<void>;
  get(userId: string): Promise<MemorySnapshot>;
  save(userId: string, memory: MemorySnapshot): Promise<MemorySnapshot>;
  clear(userId: string): Promise<void>;
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly records = new Map<string, MemorySnapshot>();

  async init(): Promise<void> {}

  async get(userId: string): Promise<MemorySnapshot> {
    return this.records.get(userId) ?? defaultMemory();
  }

  async save(userId: string, memory: MemorySnapshot): Promise<MemorySnapshot> {
    const normalized = normalizeMemory(memory);
    this.records.set(userId, normalized);
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    this.records.delete(userId);
  }
}

export class PostgresMemoryRepository implements MemoryRepository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: connectionString.includes("railway") ? { rejectUnauthorized: false } : undefined
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_memory (
        user_id TEXT PRIMARY KEY,
        memory JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async get(userId: string): Promise<MemorySnapshot> {
    const result = await this.pool.query("SELECT memory FROM user_memory WHERE user_id = $1", [userId]);
    if (result.rowCount === 0) {
      return defaultMemory();
    }
    return normalizeMemory(result.rows[0].memory as Partial<MemorySnapshot>);
  }

  async save(userId: string, memory: MemorySnapshot): Promise<MemorySnapshot> {
    const normalized = normalizeMemory(memory);
    await this.pool.query(
      `
        INSERT INTO user_memory (user_id, memory, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET memory = EXCLUDED.memory, updated_at = NOW()
      `,
      [userId, normalized]
    );
    return normalized;
  }

  async clear(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM user_memory WHERE user_id = $1", [userId]);
  }
}

export function normalizeMemory(memory: Partial<MemorySnapshot> | null | undefined): MemorySnapshot {
  const base = defaultMemory();
  return {
    preferredLanguage: stringOr(memory?.preferredLanguage, base.preferredLanguage),
    favoriteApps: uniqueStrings(memory?.favoriteApps),
    favoriteChannels: uniqueStrings(memory?.favoriteChannels),
    lastTargetApp: nullableString(memory?.lastTargetApp),
    lastTargetChannel: nullableString(memory?.lastTargetChannel),
    lastSuccessfulTask: nullableString(memory?.lastSuccessfulTask),
    aliases: recordOfStrings(memory?.aliases)
  };
}

export function applyMemoryUpdates(memory: MemorySnapshot, updates: { key: string; value: string }[]): MemorySnapshot {
  const next = normalizeMemory(memory);

  for (const update of updates) {
    const value = update.value.trim();
    if (!value) continue;

    switch (update.key) {
      case "preferredLanguage":
        next.preferredLanguage = value;
        break;
      case "lastTargetApp":
        next.lastTargetApp = value;
        if (!next.favoriteApps.includes(value)) next.favoriteApps.push(value);
        break;
      case "lastTargetChannel":
        next.lastTargetChannel = value;
        if (!next.favoriteChannels.includes(value)) next.favoriteChannels.push(value);
        break;
      case "favoriteApp":
        if (!next.favoriteApps.includes(value)) next.favoriteApps.push(value);
        break;
      case "favoriteChannel":
        if (!next.favoriteChannels.includes(value)) next.favoriteChannels.push(value);
        break;
      case "lastSuccessfulTask":
        next.lastSuccessfulTask = value;
        break;
      default:
        next.aliases[update.key] = value;
        break;
    }
  }

  return normalizeMemory(next);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    )
  );
}

function recordOfStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entryValue]) => [key, entryValue.trim()])
      .filter(([, entryValue]) => entryValue.length > 0)
  );
}
