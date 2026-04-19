"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProductTeamRunResult } from "@/lib/types";

const EXAMPLE_INPUTS = [
  "Product brief: B2B SaaS for startup finance teams to manage invoices and approvals. Problem: Users sign up but never return after day 3.",
  "Product brief: Shopify app that helps merchants recover abandoned carts with SMS campaigns. Problem: Checkout conversion dropped 30% last month.",
  "Product brief: Consumer habit tracker for busy professionals on iPhone and web. Problem: Mobile users complete fewer actions than desktop."
];

type AgentState = "idle" | "active" | "done";
type AgentKey = "researcher" | "pm" | "head";

const AGENTS: {
  key: AgentKey;
  name: string;
  model: string;
  task: string;
  icon: "search" | "clipboard" | "crown";
}[] = [
  {
    key: "researcher",
    name: "Researcher",
    model: "Claude Haiku",
    task: "Maps user pain & root causes",
    icon: "search"
  },
  {
    key: "pm",
    name: "PM",
    model: "Claude Haiku",
    task: "Drafts 3 scoped issue candidates",
    icon: "clipboard"
  },
  {
    key: "head",
    name: "Head of Product",
    model: "Claude Sonnet",
    task: "Ranks & returns final JSON",
    icon: "crown"
  }
];

const RANK_META = [
  { rank: 1, priority: "P1", label: "Highest priority" },
  { rank: 2, priority: "P2", label: "Next up" },
  { rank: 3, priority: "P3", label: "Nice to have" }
];

const PRIORITY_STYLES: Record<string, string> = {
  P1: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  P2: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  P3: "border-sky-300/40 bg-sky-300/10 text-sky-100"
};

export function RunForm() {
  const [productContext, setProductContext] = useState(EXAMPLE_INPUTS[0]);
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
    const sequence: AgentKey[] = ["researcher", "pm", "head"];
    let i = 0;
    setActiveAgent(sequence[0]);
    const step = () => {
      i += 1;
      if (i < sequence.length) {
        setActiveAgent(sequence[i]);
        stageTimerRef.current = setTimeout(step, 5000);
      }
    };
    stageTimerRef.current = setTimeout(step, 5000);
  }

  function agentState(key: AgentKey): AgentState {
    if (result) return "done";
    if (!isSubmitting) return "idle";
    if (activeAgent === key) return "active";
    const order: AgentKey[] = ["researcher", "pm", "head"];
    const activeIdx = activeAgent ? order.indexOf(activeAgent) : -1;
    const myIdx = order.indexOf(key);
    return activeIdx > myIdx ? "done" : "idle";
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlightRef.current) return;

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setResult(null);
    cycleStages();

    try {
        const response = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_context: productContext })
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
    <div className="relative z-10 flex flex-col gap-10">
      <Header />
      <Hero />

      <section className="rounded-[28px] border border-white/10 bg-white/[0.02] p-5 shadow-2xl shadow-black/40 backdrop-blur-sm lg:p-8">
        <Pipeline
          productContext={productContext}
          setProductContext={setProductContext}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          agentState={agentState}
          result={result}
          error={error}
        />
      </section>

      {result ? <NotesPanels result={result} /> : null}
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <p className="text-sm font-semibold tracking-tight text-white">
          ProductTeam<span className="text-cyan-300">.ai</span>
        </p>
      </div>
      <div className="hidden items-center gap-4 text-xs text-white/40 sm:flex">
        <span>Built for OnCode Buildathon</span>
        <span className="h-1 w-1 rounded-full bg-white/20" />
        <span>Powered by Claude</span>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <div className="max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-cyan-300/80">
        AI product team in a box
      </p>
      <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
        Vague product problem in.
        <br />
        <span className="bg-gradient-to-r from-cyan-200 via-sky-200 to-violet-200 bg-clip-text text-transparent">
          Prioritized GitHub backlog out.
        </span>
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
        One input. Add a short product brief plus the problem. Three agents reason in sequence and
        create three ranked GitHub issues in your repo before you finish your coffee.
      </p>
    </div>
  );
}

function Pipeline(props: {
  productContext: string;
  setProductContext: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  agentState: (key: AgentKey) => AgentState;
  result: ProductTeamRunResult | null;
  error: string | null;
}) {
  const { productContext, setProductContext, onSubmit, isSubmitting, agentState, result, error } = props;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(260px,1.15fr)_28px_minmax(180px,0.9fr)_28px_minmax(180px,0.9fr)_28px_minmax(180px,0.9fr)_28px_minmax(280px,1.15fr)] xl:items-stretch">
      <ProblemNode
        productContext={productContext}
        setProductContext={setProductContext}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
        error={error}
      />

      <FlowConnector active={isSubmitting || !!result} />

      {AGENTS.map((agent, idx) => {
        const state = agentState(agent.key);
        const nextActive = state === "done" || (idx === AGENTS.length - 1 && !!result);
        return (
          <AgentWithFlow
            key={agent.key}
            name={agent.name}
            model={agent.model}
            task={agent.task}
            icon={agent.icon}
            state={state}
            connectorActive={nextActive}
          />
        );
      })}

      <OutputNode result={result} isSubmitting={isSubmitting} />
    </div>
  );
}

function AgentWithFlow(props: {
  name: string;
  model: string;
  task: string;
  icon: "search" | "clipboard" | "crown";
  state: AgentState;
  connectorActive: boolean;
}) {
  return (
    <>
      <AgentNode
        name={props.name}
        model={props.model}
        task={props.task}
        icon={props.icon}
        state={props.state}
      />
      <FlowConnector active={props.connectorActive} />
    </>
  );
}

function ProblemNode(props: {
  productContext: string;
  setProductContext: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const { productContext, setProductContext, onSubmit, isSubmitting, error } = props;
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col rounded-3xl border border-cyan-300/30 bg-[#0e141c] p-5 shadow-[0_0_40px_-20px_rgba(34,211,238,0.6)]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">
          Input
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
          input
        </span>
      </div>

      <textarea
        value={productContext}
        onChange={(e) => setProductContext(e.target.value)}
        placeholder="Product brief: B2B analytics tool for ecommerce teams. Problem: Users sign up but never return after day 3."
        disabled={isSubmitting}
        className="mt-3 h-32 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm leading-6 text-white outline-none transition focus:border-cyan-300/60 disabled:opacity-60"
        required
      />

      <p className="mt-3 text-xs leading-5 text-white/50">
        Include who the product is for, what it does, and the product problem you want triaged.
      </p>

      <div className="mt-3 space-y-1.5">
        {EXAMPLE_INPUTS.map((example) => (
          <button
            type="button"
            key={example}
            onClick={() => setProductContext(example)}
            disabled={isSubmitting}
            className="block w-full truncate rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5 text-left text-xs text-white/55 transition hover:border-cyan-300/30 hover:text-white disabled:opacity-50"
          >
            {example}
          </button>
        ))}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950 shadow-[0_0_30px_-10px_rgba(34,211,238,0.9)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-300/40"
      >
        {isSubmitting ? "Running pipeline..." : "Create 3 GitHub issues →"}
      </button>

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function AgentNode(props: {
  name: string;
  model: string;
  task: string;
  icon: "search" | "clipboard" | "crown";
  state: AgentState;
}) {
  const { name, model, task, icon, state } = props;

  const border =
    state === "active"
      ? "border-cyan-300/60 shadow-[0_0_50px_-10px_rgba(34,211,238,0.55)]"
      : state === "done"
      ? "border-emerald-300/40 shadow-[0_0_30px_-18px_rgba(52,211,153,0.6)]"
      : "border-white/10";

  const dotColor =
    state === "active" ? "bg-cyan-300" : state === "done" ? "bg-emerald-400" : "bg-white/20";
  const dotPulse = state === "active" ? "pulse-dot" : "";

  const iconTint =
    state === "active" ? "text-cyan-300" : state === "done" ? "text-emerald-300" : "text-white/40";

  const iconBg =
    state === "active"
      ? "border-cyan-300/40 bg-cyan-300/10"
      : state === "done"
      ? "border-emerald-300/30 bg-emerald-300/10"
      : "border-white/10 bg-white/[0.03]";

  return (
    <div
      className={`flex flex-col rounded-3xl border ${border} bg-[#0e141c] p-5 transition-all duration-500`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex h-9 w-9 items-center justify-center rounded-xl border ${iconBg} ${iconTint} transition-colors duration-500`}
        >
          <AgentIcon kind={icon} />
        </span>
        <span className={`h-2 w-2 rounded-full ${dotColor} ${dotPulse}`} />
      </div>

      <p className="mt-4 text-lg font-semibold text-white">{name}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-300/70">
        {model}
      </p>
      <p className="mt-3 text-sm leading-6 text-white/55">{task}</p>

      <div className="mt-auto pt-4">
        <StatusPill state={state} />
      </div>
    </div>
  );
}

function AgentIcon({ kind }: { kind: "search" | "clipboard" | "crown" }) {
  const stroke = "currentColor";
  const common = { fill: "none", stroke, strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (kind === "search") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" {...common}>
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.3-4.3" />
      </svg>
    );
  }
  if (kind === "clipboard") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" {...common}>
        <rect x="5" y="5" width="14" height="16" rx="2" />
        <path d="M9 5V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1" />
        <path d="M8.5 11h7M8.5 14.5h7M8.5 18h4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" {...common}>
      <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" />
      <path d="M7 20h10" />
    </svg>
  );
}

function StatusPill({ state }: { state: AgentState }) {
  if (state === "idle") {
    return <span className="text-[11px] font-medium text-white/40">Idle</span>;
  }
  if (state === "active") {
    return (
      <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-cyan-200">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 pulse-dot" />
        Thinking...
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-emerald-300">
      <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-emerald-300" strokeWidth="2">
        <path d="M2 6.5 5 9.5 10 3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Done
    </span>
  );
}

function FlowConnector({ active }: { active: boolean }) {
  const gradId = active ? "flow-grad-active" : "flow-grad-idle";
  return (
    <div className="flex items-center justify-center">
      <svg viewBox="0 0 48 28" className="h-8 w-12 rotate-90 xl:rotate-0">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={active ? "#22d3ee" : "rgba(255,255,255,0.25)"} stopOpacity={active ? "0.3" : "1"} />
            <stop offset="100%" stopColor={active ? "#22d3ee" : "rgba(255,255,255,0.25)"} stopOpacity="1" />
          </linearGradient>
        </defs>
        <line
          x1="2"
          y1="14"
          x2="38"
          y2="14"
          stroke={`url(#${gradId})`}
          strokeWidth={active ? "3" : "2"}
          strokeLinecap="round"
          className={active ? "flow-line" : ""}
        />
        <polygon
          points="36,6 46,14 36,22"
          fill={active ? "#22d3ee" : "rgba(255,255,255,0.35)"}
          className={active ? "drop-shadow-[0_0_6px_rgba(34,211,238,0.8)]" : ""}
        />
      </svg>
    </div>
  );
}

function OutputNode({
  result,
  isSubmitting
}: {
  result: ProductTeamRunResult | null;
  isSubmitting: boolean;
}) {
  return (
    <div className="flex flex-col rounded-3xl border border-white/10 bg-[#0e141c] p-5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/50">
          Output
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
          <GithubIcon /> GitHub
        </span>
      </div>

      {!result ? (
        <div className="mt-4 flex flex-1 flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-20 rounded-xl border border-dashed ${
                isSubmitting ? "border-cyan-300/30" : "border-white/10"
              }`}
            />
          ))}
          <p className="mt-auto pt-3 text-[11px] text-white/35">
            {isSubmitting ? "Issues materializing..." : "3 ranked GitHub issues will appear here"}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {result.issues.map((issue, i) => {
            const created = result.created_issues[i];
            const priorityStyle = PRIORITY_STYLES[issue.priority] ?? PRIORITY_STYLES.P3;
            return (
              <a
                key={created.url}
                href={created.url}
                target="_blank"
                rel="noreferrer"
                className="fade-in-up group rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-cyan-300/40 hover:bg-white/[0.05]"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-5 text-white">{issue.title}</p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${priorityStyle}`}
                  >
                    {issue.priority}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/45">
                  <span className="inline-flex items-center gap-1">
                    <GithubIcon /> #{created.number}
                  </span>
                  <span className="text-cyan-300 opacity-0 transition group-hover:opacity-100">
                    open →
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NotesPanels({ result }: { result: ProductTeamRunResult }) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <NoteCard title="Researcher" model="Claude Haiku" body={result.researcher_notes} tone="cyan" />
      <NoteCard title="PM" model="Claude Haiku" body={result.pm_notes} tone="violet" />
      <NoteCard
        title="Head of Product"
        model="Claude Sonnet"
        body={`Ranked ${result.issues.length} issues from ${result.issues[0]?.priority ?? "P1"} to ${
          result.issues[result.issues.length - 1]?.priority ?? "P3"
        } and created them in GitHub.`}
        tone="emerald"
      />
    </section>
  );
}

function NoteCard({
  title,
  model,
  body,
  tone
}: {
  title: string;
  model: string;
  body: string;
  tone: "cyan" | "violet" | "emerald";
}) {
  const toneClass = useMemo(() => {
    if (tone === "violet") return "text-violet-200";
    if (tone === "emerald") return "text-emerald-200";
    return "text-cyan-200";
  }, [tone]);

  return (
    <article className="fade-in-up rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/40">{title}</p>
        <span className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${toneClass}`}>
          {model}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/70">{body}</p>
    </article>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-white/50" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
