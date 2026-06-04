import { buildRagContext, type RagContextResult } from "../entryStore";
import { askOpenAi } from "../llm/openAiClient";

export interface RagAnswer {
  answer: string;
  context: RagContextResult;
  model: string;
}

export async function askProjectMemory(args: {
  projectId: string;
  question: string;
  selectedEntryId?: string;
  limit?: number;
}): Promise<RagAnswer> {
  const context = buildRagContext({
    projectId: args.projectId,
    query: args.question,
    ...(args.selectedEntryId ? { selectedEntryId: args.selectedEntryId } : {}),
    limit: args.limit ?? 8,
  });

  const prompt = [
    "You are Rapid Prompt's project memory assistant.",
    "Answer using only the retrieved project entries below.",
    "If the retrieved context is insufficient, say what is missing.",
    "Prefer concise engineering language.",
    "Include changed files when they are relevant.",
    "Cite entry names in the answer.",
    "",
    context.contextMarkdown,
  ].join("\n");

  const result = await askOpenAi({ prompt });

  return {
    answer: result.answer,
    context,
    model: result.model,
  };
}
