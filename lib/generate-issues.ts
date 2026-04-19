import Anthropic from "@anthropic-ai/sdk";
import { Langfuse } from "langfuse-node";
import { z } from "zod";

import { getGithubRepoContext } from "@/lib/github-issues";
import type { ProductPacket, UserResearchSummary } from "@/lib/types";

// ---------------------------------------------------------------------------
// Langfuse observability
// ---------------------------------------------------------------------------

function getLangfuse() {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (!publicKey || !secretKey) return null;

  return new Langfuse({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"
  });
}

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
  priority_hint: z.string().min(1)
});

const pmOutputSchema = z.object({
  prd_markdown: z.string().min(1),
  issue_drafts: z.tuple([pmIssueDraftSchema, pmIssueDraftSchema, pmIssueDraftSchema])
});

const finalIssueSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  priority: z.string().min(1),
  ice_score: z.number().min(1).max(10),
  success_metric: z.string().min(1),
  event_to_instrument: eventSpecSchema,
  drop_off_point: z.string().min(1),
  guardrail_metric: z.string().min(1).optional()
});

const headOfProductSchema = z.object({
  issues: z.tuple([finalIssueSchema, finalIssueSchema, finalIssueSchema])
});

const MANAGER_MODEL = "claude-sonnet-4-5";
const RESEARCHER_MODEL = "claude-haiku-4-5";
const ANALYST_MODEL = "claude-haiku-4-5";
const PM_MODEL = "claude-haiku-4-5";
const HEAD_OF_PRODUCT_MODEL = "claude-sonnet-4-5";

// ---------------------------------------------------------------------------
// Manager Agent: Plans execution dynamically based on the problem
// ---------------------------------------------------------------------------

type AgentId = "researcher" | "analyst" | "pm" | "head_of_product" | "designer";

type AgentTask = {
  agent: AgentId;
  focus: string;
  priority: "critical" | "standard" | "optional";
};

type ExecutionPlan = {
  problem_type: string;
  reasoning: string;
  agent_sequence: AgentTask[];
  review_pass: boolean;
  review_focus: string;
};

const executionPlanSchema = z.object({
  problem_type: z.string().min(1),
  reasoning: z.string().min(1),
  agent_sequence: z.array(
    z.object({
      agent: z.enum(["researcher", "analyst", "pm", "head_of_product", "designer"]),
      focus: z.string().min(1),
      priority: z.enum(["critical", "standard", "optional"])
    })
  ).min(3),
  review_pass: z.boolean(),
  review_focus: z.string().min(1)
});

const reviewVerdictSchema = z.object({
  approved: z.boolean(),
  issues_found: z.array(z.string()),
  rerun_agents: z.array(z.enum(["researcher", "analyst", "pm", "head_of_product"])),
  summary: z.string().min(1)
});

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LangfuseParent = { generation: (...args: any[]) => any; span: (...args: any[]) => any } | null;

async function runAgent(
  model: string,
  system: string,
  prompt: string,
  maxTokens = 1400,
  tracingParent: LangfuseParent = null,
  generationName?: string
) {
  const client = getClient();

  const gen = tracingParent?.generation({
    name: generationName ?? `llm-${model}`,
    model,
    input: { system, prompt: prompt.slice(0, 500) },
    modelParameters: { maxTokens, temperature: 0.2 }
  });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: prompt }]
  });

  const output = getTextContent(response);

  gen?.end({
    output: output.slice(0, 500),
    usage: {
      input: response.usage?.input_tokens,
      output: response.usage?.output_tokens
    }
  });

  return output;
}

async function repairJsonOutput(raw: string, schemaHint: string, tracingParent: LangfuseParent = null) {
  return runAgent(
    PM_MODEL,
    [
      "You repair malformed JSON.",
      "Return valid JSON only.",
      "Preserve the meaning of the input.",
      `Use this exact schema: ${schemaHint}`
    ].join(" "),
    raw,
    1400,
    tracingParent,
    "json-repair"
  );
}

async function runStructuredAgent<T>(params: {
  model: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaHint: string;
  tracingParent?: LangfuseParent;
  agentName?: string;
}) {
  const span = params.tracingParent?.span({ name: params.agentName ?? "structured-agent" });
  const raw = await runAgent(params.model, params.system, params.prompt, 1400, span ?? params.tracingParent, params.agentName);

  try {
    const parsed = params.schema.parse(JSON.parse(extractJsonObject(raw)));
    span?.end({ output: JSON.stringify(parsed).slice(0, 500) });
    return parsed;
  } catch {
    span?.event({ name: "json-parse-failed", input: { raw: raw.slice(0, 300) } });
    const repaired = await repairJsonOutput(raw, params.schemaHint, span ?? params.tracingParent);
    const parsed = params.schema.parse(JSON.parse(extractJsonObject(repaired)));
    span?.end({ output: JSON.stringify(parsed).slice(0, 500) });
    return parsed;
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(value: string, max = 60) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
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

function generateWireframeSvg(params: {
  problem: string;
  research: z.infer<typeof userResearchSchema>;
  topIssue: z.infer<typeof finalIssueSchema>;
}) {
  const issueTitle = escapeXml(truncate(params.topIssue.title, 64));
  const persona = escapeXml(truncate(params.research.persona, 42));
  const dropOff = escapeXml(truncate(params.research.drop_off_point, 44));
  const problem = escapeXml(truncate(params.problem, 72));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560" fill="none" preserveAspectRatio="xMidYMid meet">
  <rect width="900" height="560" rx="24" fill="#F8F4EC"/>
  <rect x="56" y="56" width="788" height="448" rx="20" fill="#FFFDF8" stroke="#D9D1C5"/>
  <text x="88" y="100" fill="#C65A2E" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="700">LIGHTWEIGHT WIREFRAME</text>
  <text x="88" y="138" fill="#1A1815" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700">${issueTitle}</text>
  <text x="88" y="164" fill="#6B645A" font-family="Inter, Arial, sans-serif" font-size="14">${problem}</text>

  <rect x="88" y="204" width="724" height="64" rx="16" fill="#FAF7F0" stroke="#E5DDD1"/>
  <text x="112" y="230" fill="#7A7264" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700">TARGET USER</text>
  <text x="112" y="252" fill="#1A1815" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600">${persona}</text>

  <rect x="88" y="300" width="460" height="140" rx="18" fill="#FFFFFF" stroke="#D9D1C5"/>
  <text x="112" y="330" fill="#7A7264" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700">MAIN SCREEN</text>
  <rect x="112" y="352" width="412" height="24" rx="8" fill="#F4EFE6"/>
  <rect x="112" y="392" width="268" height="16" rx="8" fill="#F4EFE6"/>
  <rect x="112" y="420" width="180" height="16" rx="8" fill="#F4EFE6"/>

  <rect x="580" y="300" width="232" height="140" rx="18" fill="#FFF3EB" stroke="#F0C5AF"/>
  <text x="604" y="330" fill="#C65A2E" font-family="Inter, Arial, sans-serif" font-size="11" font-weight="700">DROP-OFF TO FIX</text>
  <text x="604" y="362" fill="#1A1815" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="600">${dropOff}</text>
  <text x="604" y="394" fill="#6B645A" font-family="Inter, Arial, sans-serif" font-size="13">Focus the top issue here.</text>

  <text x="450" y="480" text-anchor="middle" fill="#7A7264" font-family="Inter, Arial, sans-serif" font-size="10" font-weight="700">single static svg, fixed template, no model-generated layout</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Specialist runner helpers — each returns structured output
// ---------------------------------------------------------------------------

async function runResearcher(
  formattedRepoContext: string,
  formattedProblemContext: string,
  focus: string,
  tracingParent: LangfuseParent = null
) {
  return runStructuredAgent({
    model: RESEARCHER_MODEL,
    system: [
      "You are User Researcher.",
      "Return valid JSON only.",
      "Do not propose solutions.",
      "Make every field short and concrete.",
      `Manager focus directive: ${focus}`
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
      '{"persona":"string","pain_point":"string","drop_off_point":"string","hypotheses":["string","string","string"]}',
    tracingParent,
    agentName: "researcher"
  });
}

async function runAnalyst(
  formattedRepoContext: string,
  formattedProblemContext: string,
  userResearch: z.infer<typeof userResearchSchema>,
  focus: string,
  tracingParent: LangfuseParent = null
) {
  return runStructuredAgent({
    model: ANALYST_MODEL,
    system: [
      "You are Data Analyst.",
      "Return valid JSON only.",
      "Keep the analytics spec toy-sized and practical.",
      `Manager focus directive: ${focus}`
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
      '{"success_metric":"string","guardrail_metric":"string optional","event_specs":[{"name":"string","properties":["string","string"]},{"name":"string","properties":["string","string"]},{"name":"string","properties":["string","string"]}]}',
    tracingParent,
    agentName: "analyst"
  });
}

async function runPm(
  formattedRepoContext: string,
  formattedProblemContext: string,
  userResearch: z.infer<typeof userResearchSchema>,
  analyticsSpec: z.infer<typeof analyticsSpecSchema>,
  focus: string,
  tracingParent: LangfuseParent = null
) {
  return runStructuredAgent({
    model: PM_MODEL,
    system: [
      "You are PM.",
      "Return valid JSON only.",
      "Build a mini PRD markdown block and exactly 3 issue drafts.",
      "Make every artifact smaller than you want.",
      `Manager focus directive: ${focus}`
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
      '{"prd_markdown":"string","issue_drafts":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority_hint":"P1"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority_hint":"P2"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority_hint":"P3"}]}',
    tracingParent,
    agentName: "pm"
  });
}

async function runHeadOfProduct(
  formattedRepoContext: string,
  formattedProblemContext: string,
  userResearch: z.infer<typeof userResearchSchema>,
  analyticsSpec: z.infer<typeof analyticsSpecSchema>,
  pmOutput: z.infer<typeof pmOutputSchema>,
  focus: string,
  tracingParent: LangfuseParent = null
) {
  return runStructuredAgent({
    model: HEAD_OF_PRODUCT_MODEL,
    system: [
      "You are Head of Product.",
      "Return valid JSON only.",
      "Prioritize exactly 3 issues using ICE only.",
      "Normalize the final issue schema for GitHub-ready output.",
      `Manager focus directive: ${focus}`
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
      '{"issues":[{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P1","ice_score":8.1,"success_metric":"string","event_to_instrument":{"name":"string","properties":["string","string"]},"drop_off_point":"string","guardrail_metric":"string optional"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P2","ice_score":7.4,"success_metric":"string","event_to_instrument":{"name":"string","properties":["string","string"]},"drop_off_point":"string","guardrail_metric":"string optional"},{"title":"string","why":"string","acceptance_criteria":["string"],"priority":"P3","ice_score":6.8,"success_metric":"string","event_to_instrument":{"name":"string","properties":["string","string"]},"drop_off_point":"string","guardrail_metric":"string optional"}]}',
    tracingParent,
    agentName: "head-of-product"
  });
}

// ---------------------------------------------------------------------------
// Manager-driven orchestration pipeline
// ---------------------------------------------------------------------------

export async function generateIssueDrafts(problem: string): Promise<ProductPacket> {
  const normalizedProblem = problem.trim();

  if (!normalizedProblem) {
    throw new Error("Problem is required");
  }

  // ── Langfuse trace for the full pipeline run ────────────────────────
  const langfuse = getLangfuse();
  const trace = langfuse?.trace({
    name: "product-packet-pipeline",
    input: { problem: normalizedProblem },
    metadata: { version: "2.0-manager" }
  }) ?? null;

  try {
  const repoContext = await getGithubRepoContext();
  const formattedRepoContext = formatRepoContext(repoContext);
  const formattedProblemContext = formatProblemContext(normalizedProblem);

  // ── Step 1: Manager Agent creates a dynamic execution plan ──────────
  const managerSpan = trace?.span({ name: "manager-planning" }) ?? null;
  const plan = await runStructuredAgent<ExecutionPlan>({
    model: MANAGER_MODEL,
    system: [
      "You are the Manager Agent — the orchestrator of a product planning team.",
      "Return valid JSON only.",
      "Your job is to analyze the incoming product problem and create a tailored execution plan.",
      "You decide which specialist agents to invoke, what each should focus on, their order, and whether a review pass is needed.",
      "Available agents: researcher, analyst, pm, head_of_product, designer.",
      "The designer is always last and always included.",
      "You MUST always include researcher, analyst, pm, and head_of_product — but you control their focus directives.",
      "For retention/churn problems, tell the researcher to focus on churn signals and the analyst to track cohort metrics.",
      "For growth/acquisition problems, tell the researcher to focus on activation barriers and the analyst to track funnel conversion.",
      "For usability/UX problems, tell the researcher to focus on task completion failures and the analyst to track error rates.",
      "For monetization problems, tell the researcher to focus on willingness-to-pay signals and the analyst to track revenue events.",
      "Set review_pass to true when the problem is ambiguous, multi-faceted, or high-stakes.",
      "Set review_pass to false for straightforward, well-scoped problems.",
      "Keep reasoning concise (1-2 sentences)."
    ].join(" "),
    prompt: [
      "Analyze this product problem and create an execution plan for the specialist team.",
      "",
      formattedRepoContext,
      "",
      formattedProblemContext,
      "",
      "Return JSON with these keys:",
      '- "problem_type": category like "retention", "growth", "usability", "monetization", "engagement", "onboarding"',
      '- "reasoning": why you chose this plan (1-2 sentences)',
      '- "agent_sequence": array of {agent, focus, priority} objects',
      '- "review_pass": boolean — should the manager review the final output?',
      '- "review_focus": what should the review check for?'
    ].join("\n"),
    schema: executionPlanSchema,
    schemaHint:
      '{"problem_type":"retention","reasoning":"string","agent_sequence":[{"agent":"researcher","focus":"string","priority":"critical"},{"agent":"analyst","focus":"string","priority":"critical"},{"agent":"pm","focus":"string","priority":"critical"},{"agent":"head_of_product","focus":"string","priority":"standard"},{"agent":"designer","focus":"string","priority":"standard"}],"review_pass":true,"review_focus":"string"}',
    tracingParent: managerSpan,
    agentName: "manager-plan"
  });
  managerSpan?.end({ output: JSON.stringify(plan).slice(0, 500) });

  // Build a focus lookup from the plan
  const focusMap = new Map<AgentId, string>();
  for (const task of plan.agent_sequence) {
    focusMap.set(task.agent, task.focus);
  }

  // ── Step 2: Execute specialists in plan order ───────────────────────
  let userResearch = await runResearcher(
    formattedRepoContext,
    formattedProblemContext,
    focusMap.get("researcher") ?? "General user research",
    trace
  );

  let analyticsSpec = await runAnalyst(
    formattedRepoContext,
    formattedProblemContext,
    userResearch,
    focusMap.get("analyst") ?? "General analytics",
    trace
  );

  let pmOutput = await runPm(
    formattedRepoContext,
    formattedProblemContext,
    userResearch,
    analyticsSpec,
    focusMap.get("pm") ?? "General PM output",
    trace
  );

  let headOfProduct = await runHeadOfProduct(
    formattedRepoContext,
    formattedProblemContext,
    userResearch,
    analyticsSpec,
    pmOutput,
    focusMap.get("head_of_product") ?? "General prioritization",
    trace
  );

  // ── Step 3: Manager review pass (if plan requires it) ───────────────
  if (plan.review_pass) {
    const reviewSpan = trace?.span({ name: "manager-review" }) ?? null;
    const review = await runStructuredAgent({
      model: MANAGER_MODEL,
      system: [
        "You are the Manager Agent reviewing the specialist outputs.",
        "Return valid JSON only.",
        "Check if the outputs are coherent, address the original problem, and meet quality standards.",
        `Review focus: ${plan.review_focus}`,
        "If issues are minor, approve and note them. Only request reruns for critical gaps.",
        "rerun_agents should be an empty array if approved."
      ].join(" "),
      prompt: [
        "Review the specialist outputs for this problem:",
        "",
        formattedProblemContext,
        "",
        `Problem type identified: ${plan.problem_type}`,
        `Plan reasoning: ${plan.reasoning}`,
        "",
        "User Research output:",
        JSON.stringify(userResearch, null, 2),
        "",
        "Analytics Spec output:",
        JSON.stringify(analyticsSpec, null, 2),
        "",
        "PM PRD:",
        pmOutput.prd_markdown,
        "",
        "PM Issue Drafts:",
        JSON.stringify(pmOutput.issue_drafts, null, 2),
        "",
        "Head of Product final issues:",
        JSON.stringify(headOfProduct.issues, null, 2),
        "",
        "Return JSON with:",
        '- "approved": boolean',
        '- "issues_found": array of strings describing problems',
        '- "rerun_agents": array of agent names that need to rerun (empty if approved)',
        '- "summary": brief review summary'
      ].join("\n"),
      schema: reviewVerdictSchema,
      schemaHint:
        '{"approved":true,"issues_found":[],"rerun_agents":[],"summary":"string"}',
      tracingParent: reviewSpan,
      agentName: "manager-review"
    });
    reviewSpan?.end({ output: JSON.stringify(review).slice(0, 500) });

    // ── Step 4: Re-run flagged agents if needed (one retry max) ────────
    if (!review.approved && review.rerun_agents.length > 0) {
      const rerunSpan = trace?.span({ name: "rerun" }) ?? null;
      const rerunSet = new Set(review.rerun_agents);
      const rerunContext = `MANAGER FEEDBACK: ${review.issues_found.join("; ")}. Fix these issues.`;

      if (rerunSet.has("researcher")) {
        userResearch = await runResearcher(
          formattedRepoContext,
          formattedProblemContext,
          `${focusMap.get("researcher") ?? "General"} — ${rerunContext}`,
          rerunSpan
        );
      }

      if (rerunSet.has("analyst")) {
        analyticsSpec = await runAnalyst(
          formattedRepoContext,
          formattedProblemContext,
          userResearch,
          `${focusMap.get("analyst") ?? "General"} — ${rerunContext}`,
          rerunSpan
        );
      }

      if (rerunSet.has("pm")) {
        pmOutput = await runPm(
          formattedRepoContext,
          formattedProblemContext,
          userResearch,
          analyticsSpec,
          `${focusMap.get("pm") ?? "General"} — ${rerunContext}`,
          rerunSpan
        );
      }

      if (rerunSet.has("head_of_product")) {
        headOfProduct = await runHeadOfProduct(
          formattedRepoContext,
          formattedProblemContext,
          userResearch,
          analyticsSpec,
          pmOutput,
          `${focusMap.get("head_of_product") ?? "General"} — ${rerunContext}`,
          rerunSpan
        );
      }
      rerunSpan?.end({ output: `reran: ${review.rerun_agents.join(",")}` });
    }
  }

  // ── Step 5: Designer + final assembly ───────────────────────────────
  const normalizedIssues = normalizeIssues(headOfProduct.issues);
  const userJourneySummary = buildJourneySummary(userResearch);
  const wireframeSvg = generateWireframeSvg({
    problem: normalizedProblem,
    research: userResearch,
    topIssue: normalizedIssues[0]
  });

  const packet: ProductPacket = {
    execution_plan: {
      problem_type: plan.problem_type,
      reasoning: plan.reasoning,
      agent_sequence: plan.agent_sequence.map((t) => ({
        agent: t.agent,
        focus: t.focus,
        priority: t.priority
      })),
      review_pass: plan.review_pass,
      review_focus: plan.review_focus
    },
    prd_markdown: pmOutput.prd_markdown,
    user_research: userResearch,
    analytics_spec: analyticsSpec,
    user_journey_summary: userJourneySummary,
    wireframe_svg: wireframeSvg,
    issues: normalizedIssues
  };

  trace?.update({
    output: {
      problem_type: plan.problem_type,
      issue_count: normalizedIssues.length,
      review_pass: plan.review_pass
    }
  });

  return packet;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace?.update({ output: { error: message }, metadata: { status: "error" } });
    throw err;
  } finally {
    await langfuse?.shutdownAsync();
  }
}
