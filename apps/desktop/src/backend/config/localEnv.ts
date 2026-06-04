import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type LlmProvider = "openai" | "azure-openai";

interface LlmModelPricing {
  promptUsdPer1K?: number;
  completionUsdPer1K?: number;
}

interface LlmModelConfig {
  id: string;
  label: string;
  provider?: LlmProvider;
  endpoint: string;
  apiKey: string;
  model?: string;
  deployment?: string;
  apiVersion?: string;
  pricing?: LlmModelPricing;
}

interface LlmConfigFile {
  provider?: LlmProvider;
  defaultModelId: string;
  models: LlmModelConfig[];
}

export interface OpenAiSettings {
  provider: LlmProvider;
  apiKey: string;
  endpoint: string;
  model: string;
  modelId: string;
  label: string;
  apiVersion?: string;
  deployment?: string;
  pricing?: LlmModelPricing;
}

let cachedConfig: LlmConfigFile | null = null;

export async function loadOpenAiSettings(modelId?: string): Promise<OpenAiSettings> {
  const config = await loadLlmConfig();
  const selectedModelId = modelId ?? config.defaultModelId;
  const model = config.models.find((candidate) => candidate.id === selectedModelId);

  if (!model) {
    throw new Error(`Unknown LLM model id "${selectedModelId}". Check llm.config.json.`);
  }

  const provider = model.provider ?? config.provider ?? "openai";
  const resolvedModel = provider === "azure-openai"
    ? model.deployment
    : model.model;

  if (!model.apiKey.trim()) {
    throw new Error(`API key is missing for model "${model.id}". Update llm.config.json.`);
  }

  if (!model.endpoint.trim()) {
    throw new Error(`Endpoint is missing for model "${model.id}". Update llm.config.json.`);
  }

  if (!resolvedModel?.trim()) {
    throw new Error(`Model/deployment is missing for model "${model.id}". Update llm.config.json.`);
  }

  return {
    provider,
    apiKey: model.apiKey,
    endpoint: model.endpoint,
    model: resolvedModel,
    modelId: model.id,
    label: model.label,
    ...(model.apiVersion ? { apiVersion: model.apiVersion } : {}),
    ...(model.deployment ? { deployment: model.deployment } : {}),
    ...(model.pricing ? { pricing: model.pricing } : {}),
  };
}

async function loadLlmConfig(): Promise<LlmConfigFile> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = findConfigPath();
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isLlmConfigFile(parsed)) {
    throw new Error(`Invalid LLM config at ${configPath}. Expected { provider?, defaultModelId, models[] }.`);
  }

  cachedConfig = parsed;
  return cachedConfig;
}

function findConfigPath(): string {
  const resourcesPath = getResourcesPath();
  const envConfigPath = process.env.RAPID_PROMPT_LLM_CONFIG?.trim();

  const candidates = [
    ...(envConfigPath ? [envConfigPath] : []),
    path.join(os.homedir(), ".rapid_prompt", "llm.config.json"),
    ...(resourcesPath ? [path.join(resourcesPath, "llm.config.json")] : []),
    path.join(process.cwd(), "llm.config.json"),
    path.join(process.cwd(), "apps", "desktop", "llm.config.json"),
    path.join(process.cwd(), "..", "llm.config.json"),
    path.join(process.cwd(), "..", "..", "apps", "desktop", "llm.config.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "LLM config not found.",
      "Looked for llm.config.json in:",
      ...candidates.map((candidate) => `  - ${candidate}`),
      "In development, create apps/desktop/llm.config.json.",
      "In production, package llm.config.json as an electron-builder extraResource.",
    ].join("\n"),
  );
}

function getResourcesPath(): string | null {
  const processWithResources = process as NodeJS.Process & {
    resourcesPath?: string;
  };

  return processWithResources.resourcesPath ?? null;
}

function isLlmConfigFile(value: unknown): value is LlmConfigFile {
  if (!isRecord(value)) {
    return false;
  }

  const models = value.models;

  return (
    (value.provider === undefined || value.provider === "openai" || value.provider === "azure-openai") &&
    typeof value.defaultModelId === "string" &&
    Array.isArray(models) &&
    models.every(isLlmModelConfig)
  );
}

function isLlmModelConfig(value: unknown): value is LlmModelConfig {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.provider === undefined || value.provider === "openai" || value.provider === "azure-openai") &&
    typeof value.endpoint === "string" &&
    typeof value.apiKey === "string" &&
    (value.model === undefined || typeof value.model === "string") &&
    (value.deployment === undefined || typeof value.deployment === "string") &&
    (value.apiVersion === undefined || typeof value.apiVersion === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
