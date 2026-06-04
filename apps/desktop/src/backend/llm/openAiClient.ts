import { loadOpenAiSettings, type OpenAiSettings } from "../config/localEnv";

interface ResponsesApiOutputText {
  type?: string;
  text?: string;
}

interface ResponsesApiMessage {
  content?: ResponsesApiOutputText[];
}

interface ResponsesApiResponse {
  output_text?: string;
  output?: ResponsesApiMessage[];
}

interface AzureChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
}

export interface AskOpenAiArgs {
  prompt: string;
  modelId?: string;
}

export interface AskOpenAiResult {
  answer: string;
  model: string;
}

export async function askOpenAi(args: AskOpenAiArgs): Promise<AskOpenAiResult> {
  const settings = await loadOpenAiSettings(args.modelId);

  if (settings.provider === "azure-openai") {
    return askAzureOpenAi(settings, args.prompt);
  }

  return askOpenAiResponses(settings, args.prompt);
}

async function askOpenAiResponses(
  settings: OpenAiSettings,
  prompt: string,
): Promise<AskOpenAiResult> {
  const response = await fetch(openAiResponsesEndpoint(settings.endpoint), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      input: prompt,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as ResponsesApiResponse;

  return {
    answer: extractOpenAiResponseText(json),
    model: settings.model,
  };
}

async function askAzureOpenAi(
  settings: OpenAiSettings,
  prompt: string,
): Promise<AskOpenAiResult> {
  if (!settings.apiVersion) {
    throw new Error(`Azure OpenAI apiVersion is missing for model "${settings.modelId}".`);
  }

  const response = await fetch(azureChatCompletionsEndpoint(settings), {
    method: "POST",
    headers: {
      "api-key": settings.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure OpenAI request failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as AzureChatCompletionResponse;

  return {
    answer: extractAzureChatText(json),
    model: settings.model,
  };
}

function openAiResponsesEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");

  if (trimmed.endsWith("/responses")) {
    return trimmed;
  }

  return `${trimmed}/responses`;
}

function azureChatCompletionsEndpoint(settings: OpenAiSettings): string {
  const base = settings.endpoint.replace(/\/+$/, "");
  const deployment = encodeURIComponent(settings.deployment ?? settings.model);
  const apiVersion = encodeURIComponent(settings.apiVersion ?? "");

  return `${base}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
}

function extractOpenAiResponseText(response: ResponsesApiResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts: string[] = [];

  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function extractAzureChatText(response: AzureChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}
