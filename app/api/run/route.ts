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
      researcher_notes: drafts.researcher_notes,
      pm_notes: drafts.pm_notes,
      issues: drafts.issues,
      created_issues: createdIssues
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run failed";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
