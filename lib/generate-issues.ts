import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { RankedIssueDrafts } from "@/lib/types";

const issueSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  priority: z.enum(["P1", "P2", "P3"])
});

const rankedIssuesSchema = z.object({
  researcher_notes: z.string().min(1),
  pm_notes: z.string().min(1),
  issues: z.tuple([issueSchema, issueSchema, issueSchema])
});

const RESEARCHER_MODEL = "claude-haiku-4-5";
const PM_MODEL = "claude-haiku-4-5";
const HEAD_OF_PRODUCT_MODEL = "claude-sonnet-4-5";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing");
  }

  return new Anthropic({ apiKey });
}

function getTextContent(response: Anthropic.Messages.Message) {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractJsonObject(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON");
  }

  return raw.slice(start, end + 1);
}

async function runAgent(model: string, system: string, prompt: string) {
  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: prompt }]
  });

  return getTextContent(response);
}

export async function generateIssueDrafts(problem: string): Promise<RankedIssueDrafts> {
  const normalizedProblem = problem.trim();

  if (!normalizedProblem) {
    throw new Error("Problem is required");
  }

  const researcherNotes = await runAgent(
    RESEARCHER_MODEL,
    "You are Researcher. Work only on the input problem. Do not propose solutions yet.",
    [
      "Analyze the vague product problem below.",
      "Return three sections exactly:",
      "1. Core user pain",
      "2. Likely root causes",
      "3. Risks if we solve the wrong thing",
      "Keep it concise and practical.",
      "",
      `Problem: ${normalizedProblem}`
    ].join("\n")
  );

  const pmNotes = await runAgent(
    PM_MODEL,
    "You are PM. Turn the research into a tiny backlog. Stay ruthlessly scoped.",
    [
      "Using the product problem and researcher notes below, propose exactly three issue candidates.",
      "Each candidate should include:",
      "- title",
      "- why",
      "- acceptance_criteria as a short list",
      "- expected priority",
      "Do not write JSON. Plain text is fine.",
      "",
      `Problem: ${normalizedProblem}`,
      "",
      "Researcher notes:",
      researcherNotes
    ].join("\n")
  );

  const headOfProductOutput = await runAgent(
    HEAD_OF_PRODUCT_MODEL,
    [
      "You are Head of Product.",
      "Return valid JSON only.",
      "Pick the best three issue drafts, rank them from highest priority to lowest priority, and keep them demoable.",
      "Use this exact schema:",
      '{"researcher_notes":"string","pm_notes":"string","issues":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"}]}',
      "Do not include markdown fences. Do not return more than three issues."
    ].join(" "),
    [
      `Problem: ${normalizedProblem}`,
      "",
      "Researcher notes:",
      researcherNotes,
      "",
      "PM notes:",
      pmNotes
    ].join("\n")
  );

  const parsed = rankedIssuesSchema.parse(JSON.parse(extractJsonObject(headOfProductOutput)));

  return parsed;
}
