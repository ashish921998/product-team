export type IssuePriority = "P1" | "P2" | "P3";

export type EventSpec = {
  name: string;
  properties: string[];
};

export type AgentTask = {
  agent: string;
  focus: string;
  priority: "critical" | "standard" | "optional";
};

export type ExecutionPlan = {
  problem_type: string;
  reasoning: string;
  agent_sequence: AgentTask[];
  review_pass: boolean;
  review_focus: string;
};

export type UserResearchSummary = {
  persona: string;
  pain_point: string;
  drop_off_point: string;
  hypotheses: [string, string, string];
};

export type AnalyticsSpec = {
  success_metric: string;
  guardrail_metric?: string;
  event_specs: [EventSpec, EventSpec, EventSpec];
};

export type IssueDraft = {
  title: string;
  why: string;
  acceptance_criteria: string[];
  priority: IssuePriority;
  ice_score: number;
  success_metric: string;
  event_to_instrument: EventSpec;
  drop_off_point: string;
  guardrail_metric?: string;
};

export type ProductPacket = {
  execution_plan: ExecutionPlan;
  prd_markdown: string;
  user_research: UserResearchSummary;
  analytics_spec: AnalyticsSpec;
  user_journey_summary: string;
  wireframe_svg: string;
  issues: [IssueDraft, IssueDraft, IssueDraft];
};

export type CreatedGithubIssue = {
  title: string;
  url: string;
  number: number;
  priority: IssuePriority;
};

export type ProductTeamRunResult = ProductPacket & {
  created_issues: [CreatedGithubIssue, CreatedGithubIssue, CreatedGithubIssue];
};

export type WaitlistSignup = {
  name: string;
  email: string;
  company?: string;
  submitted_at: string;
};
