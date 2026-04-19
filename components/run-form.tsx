"use client";

import { useRef, useState } from "react";

import type { ProductTeamRunResult } from "@/lib/types";

const EXAMPLE_PROBLEMS = [
  "Users sign up but never return after day 3",
  "Checkout conversion dropped 30% last month",
  "Mobile users complete fewer actions than desktop"
];

export function RunForm() {
  const [problem, setProblem] = useState(EXAMPLE_PROBLEMS[0]);
  const [result, setResult] = useState<ProductTeamRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInFlightRef = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ problem })
      });

      const data = (await response.json()) as ProductTeamRunResult | { error: string };

      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Run failed");
      }

      setResult(data);
    } catch (submissionError) {
      setResult(null);
      setError(submissionError instanceof Error ? submissionError.message : "Run failed");
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/20">
        <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">ProductTeam.ai</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight text-white">
          Vague product problem in, prioritized GitHub backlog out.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-white/70">
          One input. Three agents. Three issue drafts. Three real GitHub issues in one hardcoded repo.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-3 block text-sm font-medium text-white/80">Vague product problem</span>
            <textarea
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              disabled={isSubmitting}
              className="h-48 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-base leading-7 text-white outline-none transition focus:border-cyan-300/60"
              placeholder="Users sign up but never return after day 3"
              required
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-12 items-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-300/60"
          >
            {isSubmitting ? "Creating backlog..." : "Create 3 GitHub issues"}
          </button>
        </form>

        <div className="mt-8 border-t border-white/10 pt-6">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Example prompts</p>
          <div className="mt-3 space-y-2 text-sm text-white/65">
            {EXAMPLE_PROBLEMS.map((example) => (
              <p key={example}>{example}</p>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#0f131b] p-8 shadow-2xl shadow-black/20">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Output</p>
          <p className="text-sm text-white/45">Exactly 3 issues</p>
        </div>

        {!result ? (
          <div className="mt-10 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-sm leading-7 text-white/45">
            Submit one vague product problem to generate the ranked backlog and create the GitHub issues.
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Researcher</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/70">{result.researcher_notes}</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">PM</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-white/70">{result.pm_notes}</p>
            </div>

            <div className="space-y-4">
              {result.issues.map((issue, index) => {
                const createdIssue = result.created_issues[index];

                return (
                  <article key={createdIssue.url} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-white/35">Rank {index + 1}</p>
                        <h2 className="mt-2 text-lg font-semibold text-white">{issue.title}</h2>
                      </div>
                      <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                        {issue.priority}
                      </span>
                    </div>

                    <p className="mt-4 text-sm leading-7 text-white/70">{issue.why}</p>

                    <div className="mt-4">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/35">Acceptance criteria</p>
                      <ul className="mt-3 space-y-2 text-sm leading-6 text-white/70">
                        {issue.acceptance_criteria.map((criterion) => (
                          <li key={criterion}>- {criterion}</li>
                        ))}
                      </ul>
                    </div>

                    <a
                      href={createdIssue.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-5 inline-flex text-sm font-medium text-cyan-200 underline underline-offset-4"
                    >
                      Open GitHub issue #{createdIssue.number}
                    </a>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
