import { NextResponse } from "next/server";

import { generateIssueDrafts } from "@/lib/generate-issues";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { product_context?: string; problem?: string };
    const result = await generateIssueDrafts(body.product_context ?? body.problem ?? "");

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
