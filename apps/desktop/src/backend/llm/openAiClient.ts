import { readFile } from "node:fs/promises";

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

interface OpenAiResponsesInputText {
  type: "input_text";
  text: string;
}

interface OpenAiResponsesInputImage {
  type: "input_image";
  image_url: string;
  detail: "low";
}

interface AzureChatTextPart {
  type: "text";
  text: string;
}

interface AzureChatImagePart {
  type: "image_url";
  image_url: {
    url: string;
    detail: "low";
  };
}

export interface AskOpenAiArgs {
  prompt: string;
  modelId?: string;
}

export interface AskOpenAiImage {
  path: string;
  mimeType: string;
  fileName?: string;
}

export interface AskOpenAiWithImagesArgs extends AskOpenAiArgs {
  images: AskOpenAiImage[];
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

export async function askOpenAiWithImages(
  args: AskOpenAiWithImagesArgs,
): Promise<AskOpenAiResult> {
  if (args.images.length === 0) {
    return askOpenAi(args);
  }

  const settings = await loadOpenAiSettings(args.modelId);

  if (settings.provider === "azure-openai") {
    return askAzureOpenAiWithImages(settings, args.prompt, args.images);
  }

  return askOpenAiResponsesWithImages(settings, args.prompt, args.images);
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

async function askOpenAiResponsesWithImages(
  settings: OpenAiSettings,
  prompt: string,
  images: AskOpenAiImage[],
): Promise<AskOpenAiResult> {
  const content: (OpenAiResponsesInputText | OpenAiResponsesInputImage)[] = [
    {
      type: "input_text",
      text: prompt,
    },
  ];

  for (const image of images) {
    if (image.fileName?.trim()) {
      content.push({
        type: "input_text",
        text: `Image file name: ${image.fileName}`,
      });
    }

    content.push({
      type: "input_image",
      image_url: await imageDataUrl(image),
      detail: "low",
    });
  }

  const response = await fetch(openAiResponsesEndpoint(settings.endpoint), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      input: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI vision request failed: ${response.status} ${body}`);
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

async function askAzureOpenAiWithImages(
  settings: OpenAiSettings,
  prompt: string,
  images: AskOpenAiImage[],
): Promise<AskOpenAiResult> {
  if (!settings.apiVersion) {
    throw new Error(`Azure OpenAI apiVersion is missing for model "${settings.modelId}".`);
  }

  const content: (AzureChatTextPart | AzureChatImagePart)[] = [
    {
      type: "text",
      text: prompt,
    },
  ];

  for (const image of images) {
    if (image.fileName?.trim()) {
      content.push({
        type: "text",
        text: `Image file name: ${image.fileName}`,
      });
    }

    content.push({
      type: "image_url",
      image_url: {
        url: await imageDataUrl(image),
        detail: "low",
      },
    });
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
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Azure OpenAI vision request failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as AzureChatCompletionResponse;

  return {
    answer: extractAzureChatText(json),
    model: settings.model,
  };
}

async function imageDataUrl(image: AskOpenAiImage): Promise<string> {
  const encoded = await readFile(image.path, "base64");
  return `data:${image.mimeType};base64,${encoded}`;
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
