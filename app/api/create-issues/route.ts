import { NextResponse } from "next/server";

import { createGithubIssues } from "@/lib/github-issues";
import type { IssueDraft } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { issues?: IssueDraft[] };
    const createdIssues = await createGithubIssues(body.issues ?? []);

    return NextResponse.json({ created_issues: createdIssues });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub issue creation failed";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
