import { loadOpenAiSettings } from "../config/localEnv";

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

export interface AskOpenAiArgs {
  prompt: string;
}

export interface AskOpenAiResult {
  answer: string;
  model: string;
}

export async function askOpenAi(args: AskOpenAiArgs): Promise<AskOpenAiResult> {
  const settings = await loadOpenAiSettings();

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      ...(settings.apiVersion ? { "OpenAI-Beta": settings.apiVersion } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      input: args.prompt,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${body}`);
  }

  const json = (await response.json()) as ResponsesApiResponse;

  return {
    answer: extractResponseText(json),
    model: settings.model,
  };
}

function extractResponseText(response: ResponsesApiResponse): string {
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
