export type IssuePriority = "P1" | "P2" | "P3";

export type IssueDraft = {
  title: string;
  why: string;
  acceptance_criteria: string[];
  priority: IssuePriority;
};

export type RankedIssueDrafts = {
  researcher_notes: string;
  pm_notes: string;
  issues: [IssueDraft, IssueDraft, IssueDraft];
};

export type CreatedGithubIssue = {
  title: string;
  url: string;
  number: number;
  priority: IssuePriority;
};

export type ProductTeamRunResult = RankedIssueDrafts & {
  created_issues: [CreatedGithubIssue, CreatedGithubIssue, CreatedGithubIssue];
};
