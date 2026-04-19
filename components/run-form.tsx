"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import type { IssueDraft, IssuePriority, ProductTeamRunResult } from "@/lib/types";

const EXAMPLE_PROBLEMS = [
  "New users sign up, poke around once, and never come back.",
  "Teams start a workflow but stall before the key collaboration step.",
  "Users say the product is useful, but the core feature still feels invisible."
];

type AgentKey = "researcher" | "analyst" | "pm" | "head" | "designer";
type AgentState = "idle" | "active" | "done";

const AGENTS: {
  key: AgentKey;
  label: string;
  summary: string;
}[] = [
  {
    key: "researcher",
    label: "User Researcher",
    summary: "Defines the persona, pain, drop-off, and three hypotheses."
  },
  {
    key: "analyst",
    label: "Data Analyst",
    summary: "Keeps the metrics and event spec toy-sized and useful."
  },
  {
    key: "pm",
    label: "PM",
    summary: "Writes the mini PRD and three tight issue drafts."
  },
  {
    key: "head",
    label: "Head of Product",
    summary: "Ranks exactly three issues and normalizes the final schema."
  },
  {
    key: "designer",
    label: "Designer",
    summary: "Produces one static SVG wireframe for the top issue only."
  }
];

const PRIORITY_TONE: Record<IssuePriority, string> = {
  P1: "bg-[#c65a2e]/10 text-[#c65a2e] border-[#c65a2e]/20",
  P2: "bg-[#a06a1a]/10 text-[#a06a1a] border-[#a06a1a]/20",
  P3: "bg-[#5f724a]/10 text-[#5f724a] border-[#5f724a]/20"
};

export function RunForm() {
  const [problem, setProblem] = useState(EXAMPLE_PROBLEMS[0]);
  const [result, setResult] = useState<ProductTeamRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentKey | null>(null);
  const submissionInFlightRef = useRef(false);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    };
  }, []);

  function cycleStages() {
    const sequence: AgentKey[] = ["researcher", "analyst", "pm", "head", "designer"];
    let index = 0;
    setActiveAgent(sequence[0]);

    const step = () => {
      index += 1;
      if (index < sequence.length) {
        setActiveAgent(sequence[index]);
        stageTimerRef.current = setTimeout(step, 3200);
      }
    };

    stageTimerRef.current = setTimeout(step, 3200);
  }

  function agentState(key: AgentKey): AgentState {
    if (result) return "done";
    if (!isSubmitting) return "idle";
    if (activeAgent === key) return "active";

    const order: AgentKey[] = ["researcher", "analyst", "pm", "head", "designer"];
    const activeIndex = activeAgent ? order.indexOf(activeAgent) : -1;
    const myIndex = order.indexOf(key);
    return activeIndex > myIndex ? "done" : "idle";
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlightRef.current) return;

    if (!problem.trim()) {
      setError("Enter one vague product problem.");
      return;
    }

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    cycleStages();

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem })
      });

      const data = (await response.json()) as ProductTeamRunResult | { error: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Run failed");
      }

      setResult(data);
      setActiveAgent(null);
    } catch (submissionError) {
      setResult(null);
      setError(submissionError instanceof Error ? submissionError.message : "Run failed");
      setActiveAgent(null);
    } finally {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f1e8] text-[#1a1815]">
      <section className="mx-auto max-w-7xl px-8 pb-24 pt-10">
        <TopBar />
        <Hero />

        <form onSubmit={handleSubmit} className="mt-10 rounded-[32px] border border-[#1a18151f] bg-white p-6 shadow-[0_40px_120px_-60px_rgba(26,24,21,0.45)]">
          <div className="grid gap-6 lg:grid-cols-[1.45fr_0.8fr]">
            <div>
              <label htmlFor="problem" className="mono text-[11px] uppercase tracking-[0.28em] text-[#7a7264]">
                What needs attention?
              </label>
              <textarea
                id="problem"
                value={problem}
                onChange={(event) => setProblem(event.target.value)}
                disabled={isSubmitting}
                required
                placeholder="Users sign up, but they do not reach value fast enough to come back."
                className="mt-3 h-40 w-full resize-none rounded-[24px] border border-[#1a181520] bg-[#faf7f0] px-5 py-4 text-[22px] leading-[1.35] outline-none transition focus:border-[#c65a2e] disabled:opacity-60"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {EXAMPLE_PROBLEMS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setProblem(example)}
                    disabled={isSubmitting}
                    className="rounded-full border border-[#1a181514] bg-[#faf7f0] px-3 py-1.5 text-[12px] text-[#5a5248] transition hover:border-[#c65a2e] hover:text-[#c65a2e] disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-[#1a181514] bg-[#faf7f0] p-5">
              <p className="mono text-[11px] uppercase tracking-[0.28em] text-[#7a7264]">You’ll get</p>
              <ul className="mt-4 space-y-3 text-[14px] leading-6 text-[#3a342d]">
                <li>Mini PRD markdown</li>
                <li>One static SVG wireframe</li>
                <li>One tiny analytics spec</li>
                <li>One journey summary</li>
                <li>3 real GitHub issues with live links</li>
              </ul>
              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#c65a2e] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Building your packet..." : "Create my product packet"}
              </button>
              <p className="mt-3 text-[12px] leading-5 text-[#7a7264]">
                The app creates the issues directly in the demo GitHub repo.
              </p>
            </div>
          </div>

          {error ? <p className="mt-4 text-[13px] text-[#c65a2e]">{error}</p> : null}
        </form>

        <AgentRail agentState={agentState} />
        <ResultsSection result={result} isSubmitting={isSubmitting} />
      </section>
    </div>
  );
}

function TopBar() {
  return (
    <div className="flex items-center justify-between border-b border-[#1a181514] pb-5">
      <div className="flex items-baseline gap-3">
        <span className="serif text-3xl italic">
          ProductTeam<span className="text-[#c65a2e]">.ai</span>
        </span>
        <span className="mono text-[10px] uppercase tracking-[0.32em] text-[#7a7264]">AI product packet</span>
      </div>
      <span className="mono text-[10px] uppercase tracking-[0.28em] text-[#7a7264]">Fast planning, real issues</span>
    </div>
  );
}

function Hero() {
  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
      <div>
        <p className="mono text-[11px] uppercase tracking-[0.35em] text-[#c65a2e]">
          Vague product problem in, mini product packet out.
        </p>
        <h1 className="serif mt-5 max-w-4xl text-[68px] leading-[0.92] tracking-tight">
          Turn a fuzzy product problem into a clear next move.
        </h1>
      </div>
      <p className="max-w-xl text-[15px] leading-7 text-[#4b443b]">
        Describe what feels broken, unclear, or stuck. ProductTeam.ai turns it into a compact PRD,
        one lightweight wireframe, a tiny analytics plan, a short journey summary, and three
        prioritized GitHub issues you can act on immediately.
      </p>
    </div>
  );
}

function AgentRail({ agentState }: { agentState: (key: AgentKey) => AgentState }) {
  return (
    <section className="mt-10 grid gap-3 lg:grid-cols-5">
      {AGENTS.map((agent, index) => {
        const state = agentState(agent.key);
        return (
          <article
            key={agent.key}
            className={`rounded-[24px] border p-4 transition ${
              state === "active"
                ? "border-[#c65a2e] bg-white shadow-[0_0_0_4px_rgba(198,90,46,0.08)]"
                : "border-[#1a181514] bg-white"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[0.24em] text-[#7a7264]">
                0{index + 1}
              </span>
              <StatusBadge state={state} />
            </div>
            <p className="mt-3 text-[15px] font-semibold text-[#1a1815]">{agent.label}</p>
            <p className="mt-2 text-[12px] leading-5 text-[#6a6256]">{agent.summary}</p>
          </article>
        );
      })}
    </section>
  );
}

function StatusBadge({ state }: { state: AgentState }) {
  if (state === "active") {
    return <span className="mono text-[10px] uppercase tracking-[0.24em] text-[#c65a2e]">Live</span>;
  }

  if (state === "done") {
    return <span className="mono text-[10px] uppercase tracking-[0.24em] text-[#5f724a]">Done</span>;
  }

  return <span className="mono text-[10px] uppercase tracking-[0.24em] text-[#b4a99a]">Queued</span>;
}

function ResultsSection({
  result,
  isSubmitting
}: {
  result: ProductTeamRunResult | null;
  isSubmitting: boolean;
}) {
  return (
    <section className="mt-12 rounded-[32px] border border-[#1a181514] bg-white p-6 shadow-[0_40px_120px_-70px_rgba(26,24,21,0.4)]">
      <div className="flex items-end justify-between border-b border-[#1a181510] pb-5">
        <div>
          <p className="mono text-[11px] uppercase tracking-[0.32em] text-[#7a7264]">Mini product packet</p>
          <h2 className="serif mt-3 text-4xl">
            {result ? "Your packet is ready." : isSubmitting ? "Building your packet..." : "Start with one product problem."}
          </h2>
        </div>
        {result ? <p className="mono text-[11px] text-[#7a7264]">3 live GitHub issues created</p> : null}
      </div>

      {!result ? <EmptyState isSubmitting={isSubmitting} /> : <Packet result={result} />}
    </section>
  );
}

function EmptyState({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <div className="grid gap-4 py-8 lg:grid-cols-2">
      {["Mini PRD", "Wireframe", "Analytics spec", "Journey summary", "GitHub issues"].map((label) => (
        <div key={label} className="rounded-[24px] border border-[#1a181510] bg-[#faf7f0] p-5">
          <p className="mono text-[10px] uppercase tracking-[0.24em] text-[#7a7264]">{label}</p>
          <div className="mt-4 space-y-2">
            <div className="h-4 w-2/3 rounded bg-[#1a18150b]" />
            <div className="h-4 w-5/6 rounded bg-[#1a181507]" />
            <div className="h-4 w-1/2 rounded bg-[#1a181507]" />
          </div>
        </div>
      ))}
      <p className="mono col-span-full pt-2 text-[11px] text-[#7a7264]">
        {isSubmitting ? "Analyzing the problem, drafting the packet, and creating GitHub issues..." : "Enter a product problem to generate your packet."}
      </p>
    </div>
  );
}

function Packet({ result }: { result: ProductTeamRunResult }) {
  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="space-y-5">
        <Panel title="Mini PRD markdown" eyebrow="01">
          <pre className="overflow-x-auto whitespace-pre-wrap text-[13px] leading-6 text-[#2f2a24]">
            {result.prd_markdown}
          </pre>
        </Panel>

        <Panel title="Lightweight user journey" eyebrow="02">
          <div className="space-y-4 text-[14px] leading-6 text-[#3a342d]">
            <p>{result.user_journey_summary}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <JourneyStat label="Persona" value={result.user_research.persona} />
              <JourneyStat label="Pain point" value={result.user_research.pain_point} />
              <JourneyStat label="Drop-off" value={result.user_research.drop_off_point} />
            </div>
            <div>
              <p className="mono text-[10px] uppercase tracking-[0.24em] text-[#7a7264]">Hypotheses</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {result.user_research.hypotheses.map((hypothesis) => (
                  <span
                    key={hypothesis}
                    className="rounded-full border border-[#1a181510] bg-[#faf7f0] px-3 py-1.5 text-[12px] text-[#5a5248]"
                  >
                    {hypothesis}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Lightweight analytics spec" eyebrow="03">
          <div className="space-y-4 text-[14px] leading-6 text-[#3a342d]">
            <div className="grid gap-3 md:grid-cols-2">
              <JourneyStat label="Success metric" value={result.analytics_spec.success_metric} />
              <JourneyStat
                label="Guardrail metric"
                value={result.analytics_spec.guardrail_metric ?? "Skipped for this run"}
              />
            </div>
            <div className="space-y-3">
              {result.analytics_spec.event_specs.map((event) => (
                <div key={event.name} className="rounded-2xl border border-[#1a181510] bg-[#faf7f0] p-4">
                  <p className="text-[14px] font-semibold text-[#1a1815]">{event.name}</p>
                  <p className="mono mt-2 text-[11px] uppercase tracking-[0.2em] text-[#7a7264]">
                    {event.properties.join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      <section className="space-y-5">
        <Panel title="Static SVG wireframe" eyebrow="04">
          <div
            className="overflow-hidden rounded-[22px] border border-[#1a181510] bg-[#faf7f0] p-3"
            dangerouslySetInnerHTML={{ __html: result.wireframe_svg }}
          />
        </Panel>

        <Panel title="3 prioritized GitHub issues" eyebrow="05">
          <div className="space-y-4">
            {result.issues.map((issue, index) => (
              <IssueCard
                key={result.created_issues[index].url}
                issue={issue}
                issueUrl={result.created_issues[index].url}
                issueNumber={result.created_issues[index].number}
              />
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow: string;
  children: ReactNode;
}) {
  return (
    <article className="rounded-[28px] border border-[#1a181510] bg-[#fffdf8] p-5">
      <div className="flex items-center justify-between border-b border-[#1a18150d] pb-4">
        <p className="text-[18px] font-semibold text-[#1a1815]">{title}</p>
        <span className="mono text-[10px] uppercase tracking-[0.24em] text-[#7a7264]">{eyebrow}</span>
      </div>
      <div className="pt-4">{children}</div>
    </article>
  );
}

function JourneyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#1a181510] bg-[#faf7f0] p-4">
      <p className="mono text-[10px] uppercase tracking-[0.22em] text-[#7a7264]">{label}</p>
      <p className="mt-2 text-[13px] leading-5 text-[#2f2a24]">{value}</p>
    </div>
  );
}

function IssueCard({
  issue,
  issueUrl,
  issueNumber
}: {
  issue: IssueDraft;
  issueUrl: string;
  issueNumber: number;
}) {
  return (
    <a
      href={issueUrl}
      target="_blank"
      rel="noreferrer"
      className="block rounded-[24px] border border-[#1a181510] bg-[#faf7f0] p-5 transition hover:border-[#c65a2e]/30 hover:bg-[#fff8f3]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${PRIORITY_TONE[issue.priority]}`}>
              {issue.priority}
            </span>
            <span className="mono text-[11px] text-[#7a7264]">ICE {issue.ice_score}</span>
          </div>
          <p className="mt-3 text-[20px] font-semibold leading-6 text-[#1a1815]">{issue.title}</p>
          <p className="mt-2 text-[13px] leading-6 text-[#3a342d]">{issue.why}</p>
        </div>
        <span className="mono shrink-0 text-[12px] text-[#7a7264]">#{issueNumber}</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <JourneyStat label="Success metric" value={issue.success_metric} />
        <JourneyStat label="Drop-off point" value={issue.drop_off_point} />
      </div>

      <div className="mt-4 rounded-2xl border border-[#1a181510] bg-white p-4">
        <p className="mono text-[10px] uppercase tracking-[0.22em] text-[#7a7264]">Event to instrument</p>
        <p className="mt-2 text-[13px] font-semibold text-[#1a1815]">{issue.event_to_instrument.name}</p>
        <p className="mono mt-1 text-[11px] text-[#7a7264]">
          {issue.event_to_instrument.properties.join(" · ")}
        </p>
      </div>

      <div className="mt-4">
        <p className="mono text-[10px] uppercase tracking-[0.22em] text-[#7a7264]">Acceptance criteria</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {issue.acceptance_criteria.map((criterion) => (
            <span
              key={criterion}
              className="rounded-full border border-[#1a181510] bg-white px-3 py-1.5 text-[12px] text-[#5a5248]"
            >
              {criterion}
            </span>
          ))}
        </div>
      </div>
    </a>
  );
}
