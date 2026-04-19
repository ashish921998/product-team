import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getGithubRepoContext } from "@/lib/github-issues";
import type { RankedIssueDrafts } from "@/lib/types";

const issueSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  priority: z.enum(["P1", "P2", "P3"])
});

const rankedIssuesSchema = z.object({
  user_researcher_notes: z.string().min(1),
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

async function repairJsonOutput(raw: string) {
  return runAgent(
    PM_MODEL,
    [
      "You repair malformed JSON.",
      "Return valid JSON only.",
      "Preserve the meaning of the input.",
      "Use this exact schema:",
      '{"user_researcher_notes":"string","pm_notes":"string","issues":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"}]}'
    ].join(" "),
    raw
  );
}

async function parseRankedIssues(raw: string) {
  try {
    return rankedIssuesSchema.parse(JSON.parse(extractJsonObject(raw)));
  } catch {
    const repaired = await repairJsonOutput(raw);
    return rankedIssuesSchema.parse(JSON.parse(extractJsonObject(repaired)));
  }
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

function formatRepoContext(context: Awaited<ReturnType<typeof getGithubRepoContext>>) {
  return [
    `Target repo: ${context.owner}/${context.repo}`,
    context.readme ? "README summary:" : "README summary: unavailable",
    context.readme ?? "",
    "",
    context.recent_issue_titles.length > 0 ? "Recent open issue titles:" : "Recent open issue titles: none",
    ...context.recent_issue_titles.map((title) => `- ${title}`)
  ]
    .filter(Boolean)
    .join("\n");
}

function formatProductContext(productDocument: string, problem: string) {
  return ["product.md:", productDocument, "", "Current product problem:", problem].join("\n");
}

export async function generateIssueDrafts(productDocument: string, problem: string): Promise<RankedIssueDrafts> {
  const normalizedProductDocument = productDocument.trim();
  const normalizedProblem = problem.trim();

  if (!normalizedProductDocument) {
    throw new Error("product.md is required");
  }

  if (!normalizedProblem) {
    throw new Error("Problem is required");
  }

  const repoContext = await getGithubRepoContext();
  const formattedRepoContext = formatRepoContext(repoContext);
  const formattedProductContext = formatProductContext(normalizedProductDocument, normalizedProblem);

  const userResearcherNotes = await runAgent(
    RESEARCHER_MODEL,
    [
      "You are User Researcher.",
      "Work only on the repo context, saved product.md, and current product problem provided.",
      "Do not propose solutions or implementation details.",
      "Focus on the user, their context, and what evidence is still missing."
    ].join(" "),
    [
      "Analyze the repo context, saved product.md, and current product problem below.",
      "Return four sections exactly:",
      "1. Target user persona",
      "2. Primary pain and likely workflow breakdown",
      "3. Top research questions to validate",
      "4. Missing evidence and research risks",
      "For the target user persona, name the user type and the job they are trying to get done.",
      "For the research questions section, provide exactly three bullet points.",
      "Keep it concise and practical.",
      "",
      "Use the repo context to stay grounded in what the product already is.",
      "Avoid proposing issues that clearly duplicate the recent open issues if possible.",
      "",
      formattedRepoContext,
      "",
      formattedProductContext
    ].join("\n")
  );

  const pmNotes = await runAgent(
    PM_MODEL,
    "You are PM. Turn the research into a tiny backlog. Stay ruthlessly scoped.",
    [
      "Using the repo context, saved product.md, current product problem, and user researcher notes below, propose exactly three issue candidates.",
      "Use the target persona, workflow breakdown, and research questions to make each issue feel grounded in real user behavior.",
      "Prefer issues that either reduce the user pain directly or close a critical evidence gap before the team builds the wrong thing.",
      "Each candidate should include:",
      "- title",
      "- why",
      "- acceptance_criteria as a short list",
      "- expected priority",
      "Do not write JSON. Plain text is fine.",
      "Avoid obvious duplicates of recent open issues.",
      "",
      formattedRepoContext,
      "",
      formattedProductContext,
      "",
      "User researcher notes:",
      userResearcherNotes
    ].join("\n")
  );

  const headOfProductOutput = await runAgent(
    HEAD_OF_PRODUCT_MODEL,
    [
      "You are Head of Product.",
      "Return valid JSON only.",
      "Pick the best three issue drafts, rank them from highest priority to lowest priority, and keep them demoable.",
      "Use the repo context to prefer issues that fit the current product and avoid obvious duplicates of recent open issues.",
      "Use this exact schema:",
      '{"user_researcher_notes":"string","pm_notes":"string","issues":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1|P2|P3"}]}',
      "Do not include markdown fences. Do not return more than three issues."
    ].join(" "),
    [
      formattedRepoContext,
      "",
      formattedProductContext,
      "",
      "User researcher notes:",
      userResearcherNotes,
      "",
      "PM notes:",
      pmNotes
    ].join("\n")
  );

  const parsed = await parseRankedIssues(headOfProductOutput);

  return parsed;
}
