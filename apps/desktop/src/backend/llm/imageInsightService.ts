import type { ImageAttachment } from "../attachments/imageAttachmentStore";
import { askOpenAiWithImages } from "./openAiClient";

export type ImageInsightStatus = "completed" | "failed";

export interface ImageInsight {
  imageId: string;
  sha256: string;
  fileName: string;
  status: ImageInsightStatus;
  summary: string;
  visibleText: string[];
  technicalTags: string[];
  uiElements: string[];
  implementationHints: string[];
  researchConcepts: string[];
  rawAnswer: string;
  model?: string;
  error?: string;
  generatedAt: string;
}

interface ImageInsightJson {
  summary?: unknown;
  visibleText?: unknown;
  technicalTags?: unknown;
  uiElements?: unknown;
  implementationHints?: unknown;
  researchConcepts?: unknown;
}

export async function analyzeImageAttachments(
  attachments: ImageAttachment[],
): Promise<ImageInsight[]> {
  const insights: ImageInsight[] = [];

  for (const attachment of attachments) {
    insights.push(await analyzeImageAttachment(attachment));
  }

  return insights;
}

export function renderImageInsightsMarkdown(insights: ImageInsight[]): string {
  if (insights.length === 0) {
    return "";
  }

  const lines: string[] = ["# Image Insights", ""];

  for (const insight of insights) {
    lines.push(`## ${insight.fileName}`);
    lines.push(`Status: ${insight.status}`);
    lines.push(`SHA-256: ${insight.sha256}`);

    if (insight.model) {
      lines.push(`Model: ${insight.model}`);
    }

    lines.push("");
    lines.push("Summary:");
    lines.push(insight.summary || "No summary.");

    if (insight.visibleText.length > 0) {
      lines.push("");
      lines.push("Visible text:");
      insight.visibleText.forEach((item) => lines.push(`- ${item}`));
    }

    if (insight.technicalTags.length > 0) {
      lines.push("");
      lines.push(`Technical tags: ${insight.technicalTags.join(", ")}`);
    }

    if (insight.uiElements.length > 0) {
      lines.push("");
      lines.push(`UI elements: ${insight.uiElements.join(", ")}`);
    }

    if (insight.implementationHints.length > 0) {
      lines.push("");
      lines.push("Implementation hints:");
      insight.implementationHints.forEach((item) => lines.push(`- ${item}`));
    }

    if (insight.researchConcepts.length > 0) {
      lines.push("");
      lines.push("Research concepts:");
      insight.researchConcepts.forEach((item) => lines.push(`- ${item}`));
    }

    if (insight.error) {
      lines.push("");
      lines.push(`Error: ${insight.error}`);
    }

    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

async function analyzeImageAttachment(
  attachment: ImageAttachment,
): Promise<ImageInsight> {
  const generatedAt = new Date().toISOString();

  try {
    const result = await askOpenAiWithImages({
      prompt: imageAnalysisPrompt(attachment.fileName),
      images: [
        {
          path: attachment.storedPath,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
        },
      ],
    });

    const parsed = parseImageInsightJson(result.answer);

    return {
      imageId: attachment.id,
      sha256: attachment.sha256,
      fileName: attachment.fileName,
      status: "completed",
      summary: parsed.summary,
      visibleText: parsed.visibleText,
      technicalTags: parsed.technicalTags,
      uiElements: parsed.uiElements,
      implementationHints: parsed.implementationHints,
      researchConcepts: parsed.researchConcepts,
      rawAnswer: result.answer,
      model: result.model,
      generatedAt,
    };
  } catch (error: unknown) {
    return {
      imageId: attachment.id,
      sha256: attachment.sha256,
      fileName: attachment.fileName,
      status: "failed",
      summary: "Image analysis failed.",
      visibleText: [],
      technicalTags: [],
      uiElements: [],
      implementationHints: [],
      researchConcepts: [],
      rawAnswer: "",
      error: toErrorMessage(error),
      generatedAt,
    };
  }
}

function imageAnalysisPrompt(fileName: string): string {
  return [
    "Analyze this image for Rapid Prompt project memory.",
    "Return JSON only. No Markdown. No prose outside JSON.",
    "The JSON shape must be:",
    "{",
    "  \"summary\": \"concise visual summary\",",
    "  \"visibleText\": [\"important text visible in the image\"],",
    "  \"technicalTags\": [\"searchable technical tags\"],",
    "  \"uiElements\": [\"UI/layout elements if any\"],",
    "  \"implementationHints\": [\"implementation details or engineering implications\"],",
    "  \"researchConcepts\": [\"research concepts or ideas represented\"]",
    "}",
    "",
    `File name: ${fileName}`,
    "",
    "Focus on attributes that make the image searchable later.",
    "For UI screenshots, identify controls, layout, panels, labels, workflow state, and design intent.",
    "For research screenshots, identify the concept, diagram structure, entities, claims, and reusable insights.",
  ].join("\n");
}

function parseImageInsightJson(raw: string): {
  summary: string;
  visibleText: string[];
  technicalTags: string[];
  uiElements: string[];
  implementationHints: string[];
  researchConcepts: string[];
} {
  const parsed = parseJsonObject(raw);
  const value = parsed ?? {};

  return {
    summary: stringValue(value.summary, raw.trim()),
    visibleText: stringArray(value.visibleText),
    technicalTags: stringArray(value.technicalTags),
    uiElements: stringArray(value.uiElements),
    implementationHints: stringArray(value.implementationHints),
    researchConcepts: stringArray(value.researchConcepts),
  };
}

function parseJsonObject(raw: string): ImageInsightJson | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 24);
}

function isRecord(value: unknown): value is ImageInsightJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error === null || error === undefined) {
    return "Unknown error";
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}
