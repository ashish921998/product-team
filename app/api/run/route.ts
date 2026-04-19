import { NextResponse } from "next/server";

import { generateIssueDrafts } from "@/lib/generate-issues";
import { createGithubIssues } from "@/lib/github-issues";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { problem?: string };
    const drafts = await generateIssueDrafts(body.problem ?? "");
    const createdIssues = await createGithubIssues(drafts.issues);

    return NextResponse.json({
      execution_plan: drafts.execution_plan,
      prd_markdown: drafts.prd_markdown,
      user_research: drafts.user_research,
      analytics_spec: drafts.analytics_spec,
      user_journey_summary: drafts.user_journey_summary,
      wireframe_svg: drafts.wireframe_svg,
      issues: drafts.issues,
      created_issues: createdIssues
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run failed";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
