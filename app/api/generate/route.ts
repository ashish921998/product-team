import { NextResponse } from "next/server";

import { generateIssueDrafts } from "@/lib/generate-issues";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { problem?: string };
    const result = await generateIssueDrafts(body.problem ?? "");

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
