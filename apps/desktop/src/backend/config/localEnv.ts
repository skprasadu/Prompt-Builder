import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface OpenAiSettings {
  apiKey: string;
  endpoint: string;
  model: string;
  apiVersion?: string;
}

let cachedEnv: Record<string, string> | null = null;

export async function loadOpenAiSettings(): Promise<OpenAiSettings> {
  const env = await loadLocalEnv();
  const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to .env.local or your shell environment.");
  }

  const endpoint =
    env.OPENAI_RESPONSES_ENDPOINT ??
    process.env.OPENAI_RESPONSES_ENDPOINT ??
    buildResponsesEndpoint(env.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL);

  const model = env.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const apiVersion = env.OPENAI_API_VERSION ?? process.env.OPENAI_API_VERSION;

  return {
    apiKey,
    endpoint,
    model,
    ...(apiVersion ? { apiVersion } : {}),
  };
}

async function loadLocalEnv(): Promise<Record<string, string>> {
  if (cachedEnv) {
    return cachedEnv;
  }

  const envPath = findEnvPath();

  if (!envPath) {
    cachedEnv = {};
    return cachedEnv;
  }

  const raw = await readFile(envPath, "utf8");
  cachedEnv = parseEnv(raw);

  return cachedEnv;
}

function findEnvPath(): string | null {
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), "..", ".env.local"),
    path.join(process.cwd(), "..", "..", ".env.local"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripQuotes(trimmed.slice(separatorIndex + 1).trim());

    out[key] = value;
  }

  return out;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value.at(0);
    const last = value.at(-1);

    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }

  return value;
}

function buildResponsesEndpoint(baseUrl?: string): string {
  const base = (baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${base}/responses`;
}
