import { NextResponse } from "next/server";
import { Octokit } from "octokit";
import { z } from "zod";

import type { WaitlistSignup } from "@/lib/types";

export const runtime = "nodejs";

const WAITLIST_GIST_FILENAME = "product-team-waitlist.json";

const waitlistSignupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  company: z.string().trim().max(120).optional().or(z.literal(""))
});

function getOctokit() {
  const auth = process.env.GITHUB_TOKEN;

  if (!auth) {
    throw new Error("GITHUB_TOKEN is missing");
  }

  return new Octokit({ auth });
}

function parseStoredSignups(content: string | undefined) {
  if (!content) return [] as WaitlistSignup[];

  const parsed = JSON.parse(content) as unknown;
  return z.array(
    z.object({
      name: z.string(),
      email: z.string(),
      company: z.string().optional(),
      submitted_at: z.string()
    })
  ).parse(parsed);
}

function normalizeGistId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const gistMatch = trimmed.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)/i);
  return gistMatch?.[1] ?? trimmed;
}

async function appendSignupToGist(signup: WaitlistSignup, gistId: string) {
  const octokit = getOctokit();
  const gist = await octokit.rest.gists.get({ gist_id: gistId });
  const currentContent = gist.data.files?.[WAITLIST_GIST_FILENAME]?.content;
  const signups = parseStoredSignups(currentContent);

  signups.push(signup);

  await octokit.rest.gists.update({
    gist_id: gistId,
    files: {
      [WAITLIST_GIST_FILENAME]: {
        content: JSON.stringify(signups, null, 2)
      }
    }
  });
}

export async function POST(request: Request) {
  try {
    const body = waitlistSignupSchema.parse(await request.json());
    const signup: WaitlistSignup = {
      name: body.name,
      email: body.email.toLowerCase(),
      company: body.company || undefined,
      submitted_at: new Date().toISOString()
    };

    const gistId = normalizeGistId(process.env.WAITLIST_GIST_ID ?? "");
    const webhookUrl = process.env.WAITLIST_WEBHOOK_URL;

    if (gistId) {
      await appendSignupToGist(signup, gistId);
    } else if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signup)
      });

      if (!response.ok) {
        throw new Error("Waitlist storage failed");
      }
    }

    console.info("WAITLIST_SIGNUP", signup);

    return NextResponse.json({
      ok: true,
      message: gistId || webhookUrl ? "You are on the list." : "Signup captured."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signup failed";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
