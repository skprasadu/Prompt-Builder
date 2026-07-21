// Keep the tokenizer isolated so you can swap models later if needed.
import { encode as encodeGpt4o } from "gpt-tokenizer/model/gpt-4o";

export function countTokens(text: string): number {
  return encodeGpt4o(text).length;
}