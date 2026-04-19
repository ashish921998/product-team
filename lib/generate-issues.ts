import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getGithubRepoContext } from "@/lib/github-issues";
import type { ProductPacket, UserResearchSummary } from "@/lib/types";

const eventSpecSchema = z.object({
  name: z.string().min(1),
  properties: z.array(z.string().min(1)).min(2).max(3)
});

const userResearchSchema = z.object({
  persona: z.string().min(1),
  pain_point: z.string().min(1),
  drop_off_point: z.string().min(1),
  hypotheses: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)])
});

const analyticsSpecSchema = z.object({
  success_metric: z.string().min(1),
  guardrail_metric: z.string().min(1).optional(),
  event_specs: z.tuple([eventSpecSchema, eventSpecSchema, eventSpecSchema])
});

const pmIssueDraftSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  priority_hint: z.enum(["P1", "P2", "P3"])
});

const pmOutputSchema = z.object({
  prd_markdown: z.string().min(1),
  issue_drafts: z.tuple([pmIssueDraftSchema, pmIssueDraftSchema, pmIssueDraftSchema])
});

const finalIssueSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  priority: z.enum(["P1", "P2", "P3"]),
  ice_score: z.number().min(1).max(10),
  success_metric: z.string().min(1),
  event_to_instrument: eventSpecSchema,
  drop_off_point: z.string().min(1),
  guardrail_metric: z.string().min(1).optional()
});

const headOfProductSchema = z.object({
  issues: z.tuple([finalIssueSchema, finalIssueSchema, finalIssueSchema])
});

const RESEARCHER_MODEL = "claude-haiku-4-5";
const ANALYST_MODEL = "claude-haiku-4-5";
const PM_MODEL = "claude-haiku-4-5";
const HEAD_OF_PRODUCT_MODEL = "claude-sonnet-4-5";
const DESIGNER_MODEL = "claude-sonnet-4-5";

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

function extractSvg(raw: string) {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return SVG");
  }

  return raw.slice(start, end + 6).replace(/<script[\s\S]*?<\/script>/gi, "").trim();
}

async function runAgent(model: string, system: string, prompt: string, maxTokens = 1400) {
  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: prompt }]
  });

  return getTextContent(response);
}

async function repairJsonOutput(raw: string, schemaHint: string) {
  return runAgent(
    PM_MODEL,
    [
      "You repair malformed JSON.",
      "Return valid JSON only.",
      "Preserve the meaning of the input.",
      `Use this exact schema: ${schemaHint}`
    ].join(" "),
    raw,
    1400
  );
}

async function runStructuredAgent<T>(params: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaHint: string;
}) {
  const raw = await runAgent(params.model, params.system, params.prompt);

  try {
    return params.schema.parse(JSON.parse(extractJsonObject(raw)));
  } catch {
    const repaired = await repairJsonOutput(raw, params.schemaHint);
    return params.schema.parse(JSON.parse(extractJsonObject(repaired)));
  }
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

function formatProblemContext(problem: string) {
  return [`Vague product problem:`, problem].join("\n");
}

function buildJourneySummary(research: UserResearchSummary) {
  return [
    `${research.persona} tries to move through the core workflow but hits ${research.pain_point.toLowerCase()}.`,
    `The likely breakpoint is ${research.drop_off_point.toLowerCase()}.`,
    `Top hypotheses: ${research.hypotheses.join("; ")}.`
  ].join(" ");
}

function normalizeIssues(issues: z.infer<typeof finalIssueSchema>[]) {
  return issues.map((issue, index) => ({
    ...issue,
    priority: (`P${index + 1}` as const),
    ice_score: Math.round(issue.ice_score * 10) / 10
  })) as ProductPacket["issues"];
}

async function generateWireframeSvg(params: {
  problem: string;
  research: z.infer<typeof userResearchSchema>;
  topIssue: z.infer<typeof finalIssueSchema>;
}) {
  const raw = await runAgent(
    DESIGNER_MODEL,
    [
      "You are Designer.",
      "Generate exactly one lightweight wireframe only.",
      "Return raw SVG only.",
      "Static SVG only. No markdown fences. No prose.",
      "Do not generate multiple screens.",
      "Do not generate polished UI. Keep it clearly wireframe-level."
    ].join(" "),
    [
      "Create one static SVG wireframe for the top-priority issue only.",
      "The wireframe should feel toy-sized and demoable.",
      "Use a single desktop canvas around 900x560.",
      "Use simple rectangles, labels, arrows, and 1 accent color max.",
      "Include a title in the wireframe matching the issue title.",
      "Ground the layout in the persona and drop-off point.",
      "Do not include implementation notes outside the SVG.",
      "",
      formatProblemContext(params.problem),
      "",
      `Persona: ${params.research.persona}`,
      `Pain point: ${params.research.pain_point}`,
      `Drop-off point: ${params.research.drop_off_point}`,
      `Top issue title: ${params.topIssue.title}`,
      `Top issue why: ${params.topIssue.why}`
    ].join("\n"),
    1600
  );

  return extractSvg(raw);
}

export async function generateIssueDrafts(problem: string): Promise<ProductPacket> {
  const normalizedProblem = problem.trim();

  if (!normalizedProblem) {
    throw new Error("Problem is required");
  }

  const repoContext = await getGithubRepoContext();
  const formattedRepoContext = formatRepoContext(repoContext);
  const formattedProblemContext = formatProblemContext(normalizedProblem);

  const userResearch = await runStructuredAgent({
    model: RESEARCHER_MODEL,
    system: [
      "You are User Researcher.",
      "Return valid JSON only.",
      "Do not propose solutions.",
      "Make every field short and concrete."
    ].join(" "),
    prompt: [
      "Analyze the vague product problem using the repo context.",
      "Return only these keys:",
      '- "persona"',
      '- "pain_point"',
      '- "drop_off_point"',
      '- "hypotheses" as exactly 3 short bullets in an array',
      "Stay tightly scoped. This is a 4-hour buildathon demo.",
      "",
      formattedRepoContext,
      "",
      formattedProblemContext
    ].join("\n"),
    schema: userResearchSchema,
    schemaHint:
      '{"persona":"string","pain_point":"string","drop_off_point":"string","hypotheses":["string","string","string"]}'
  });

  const analyticsSpec = await runStructuredAgent({
    model: ANALYST_MODEL,
    system: [
      "You are Data Analyst.",
      "Return valid JSON only.",
      "Keep the analytics spec toy-sized and practical."
    ].join(" "),
    prompt: [
      "Return only these keys:",
      '- "success_metric"',
      '- optional "guardrail_metric"',
      '- "event_specs" as exactly 3 events because the final packet will contain 3 issues',
      "Each event must have:",
      '- "name"',
      '- "properties" with 2-3 short properties only',
      "Keep one event per issue max.",
      "",
      formattedRepoContext,
      "",
      formattedProblemContext,
      "",
      `Persona: ${userResearch.persona}`,
      `Pain point: ${userResearch.pain_point}`,
      `Drop-off point: ${userResearch.drop_off_point}`
    ].join("\n"),
    schema: analyticsSpecSchema,
    schemaHint:
      '{"success_metric":"string","guardrail_metric":"string optional","event_specs":[{"name":"string","properties":["string","string"]},{"name":"string","properties":["string","string"]},{"name":"string","properties":["string","string"]}]}'
  });

  const pmOutput = await runStructuredAgent({
    model: PM_MODEL,
    system: [
      "You are PM.",
      "Return valid JSON only.",
      "Build a mini PRD markdown block and exactly 3 issue drafts.",
      "Make every artifact smaller than you want."
    ].join(" "),
    prompt: [
      "Generate:",
      '- one short PRD markdown block under "prd_markdown"',
      '- exactly 3 issue drafts under "issue_drafts"',
      "The PRD markdown must contain only these headings:",
      "- Problem",
      "- Persona",
      "- Pain point",
      "- Proposed solution",
      "- Success metric",
      "- Prioritized backlog summary",
      "Each issue draft must contain only:",
      '- "title"',
      '- "why"',
      '- "acceptance_criteria"',
      '- "priority_hint"',
      "Avoid duplicates of recent open issues.",
      "",
      formattedRepoContext,
      "",
      formattedProblemContext,
      "",
      `Persona: ${userResearch.persona}`,
      `Pain point: ${userResearch.pain_point}`,
      `Drop-off point: ${userResearch.drop_off_point}`,
      `Success metric: ${analyticsSpec.success_metric}`,
      analyticsSpec.guardrail_metric ? `Guardrail metric: ${analyticsSpec.guardrail_metric}` : "",
      "Event specs:",
      ...analyticsSpec.event_specs.map(
        (event, index) => `${index + 1}. ${event.name} (${event.properties.join(", ")})`
      )
    ]
      .filter(Boolean)
      .join("\n"),
    schema: pmOutputSchema,
    schemaHint:
      '{"prd_markdown":"string","issue_drafts":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority_hint":"P1"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority_hint":"P2"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority_hint":"P3"}]}'
  });

  const headOfProduct = await runStructuredAgent({
    model: HEAD_OF_PRODUCT_MODEL,
    system: [
      "You are Head of Product.",
      "Return valid JSON only.",
      "Prioritize exactly 3 issues using ICE only.",
      "Normalize the final issue schema for GitHub-ready output."
    ].join(" "),
    prompt: [
      "Take the PM output and prepare final GitHub-ready issues.",
      "Return exactly 3 issues in ranked order.",
      "Use ICE only. Do not add RICE.",
      "Use this exact final schema for each issue:",
      '- "title"',
      '- "why"',
      '- "acceptance_criteria"',
      '- "priority"',
      '- "ice_score"',
      '- "success_metric"',
      '- "event_to_instrument"',
      '- "drop_off_point"',
      '- optional "guardrail_metric"',
      "Map at most one event to each issue.",
      "Avoid duplicates of recent open issues.",
      "",
      formattedRepoContext,
      "",
      formattedProblemContext,
      "",
      `Persona: ${userResearch.persona}`,
      `Pain point: ${userResearch.pain_point}`,
      `Drop-off point: ${userResearch.drop_off_point}`,
      `Success metric: ${analyticsSpec.success_metric}`,
      analyticsSpec.guardrail_metric ? `Guardrail metric: ${analyticsSpec.guardrail_metric}` : "",
      "Event specs:",
      ...analyticsSpec.event_specs.map(
        (event, index) => `${index + 1}. ${event.name} (${event.properties.join(", ")})`
      ),
      "",
      "PM PRD markdown:",
      pmOutput.prd_markdown,
      "",
      "PM issue drafts:",
      JSON.stringify(pmOutput.issue_drafts, null, 2)
    ]
      .filter(Boolean)
      .join("\n"),
    schema: headOfProductSchema,
    schemaHint:
      '{"issues":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1","ice_score":8.1,"success_metric":"string","event_to_instrument":{"name":"string","properties":["string","string"]},"drop_off_point":"string","guardrail_metric":"string optional"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P2","ice_score":7.4,"success_metric":"string","event_to_instrument":{"name":"string","properties":["string","string"]},"drop_off_point":"string","guardrail_metric":"string optional"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P3","ice_score":6.8,"success_metric":"string","event_to_instrument":{"name":"string","properties":["string","string"]},"drop_off_point":"string","guardrail_metric":"string optional"}]}'
  });

  const normalizedIssues = normalizeIssues(headOfProduct.issues);
  const userJourneySummary = buildJourneySummary(userResearch);
  const wireframeSvg = await generateWireframeSvg({
    problem: normalizedProblem,
    research: userResearch,
    topIssue: normalizedIssues[0]
  });

  return {
    prd_markdown: pmOutput.prd_markdown,
    user_research: userResearch,
    analytics_spec: analyticsSpec,
    user_journey_summary: userJourneySummary,
    wireframe_svg: wireframeSvg,
    issues: normalizedIssues
  };
}
