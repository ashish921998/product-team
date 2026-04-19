"use client";

import { useEffect, useRef, useState } from "react";

import type { IssueDraft, IssuePriority, ProductTeamRunResult } from "@/lib/types";

const PRODUCT_MD_STORAGE_KEY = "productteam.product-md";

const DEFAULT_PRODUCT_MD = `# Product

## One-liner
AI product team in a box that turns product problems into ranked GitHub issues.

## Target users
- Product teams shipping quickly with limited PM or research bandwidth
- Founders or builders who need backlog direction fast

## Core workflow
- User shares product context once in product.md
- User enters one current product problem
- ProductTeam.ai runs User Researcher -> PM -> Head of Product
- App returns exactly 3 ranked issue drafts and creates them in GitHub

## Constraints
- Single-page demo
- Hardcoded GitHub repo
- Exactly 3 issues per run
- Keep outputs tightly scoped and demoable`;

const EXAMPLE_PROBLEMS = [
  "New users sign up but rarely come back after day 3.",
  "Checkout conversion dropped 30% last month.",
  "Mobile users complete fewer key actions than desktop users."
];

type AgentKey = "researcher" | "pm" | "head";
type AgentState = "idle" | "active" | "done";

const AGENTS: {
  key: AgentKey;
  name: string;
  role: string;
  model: string;
  bio: string;
  initial: string;
  avatarClass: string;
}[] = [
  {
    key: "researcher",
    name: "Ana",
    role: "User Researcher",
    model: "claude-haiku-4-5",
    bio: "Reads your brief. Maps the core user pain, likely root causes, and risks of solving the wrong thing first.",
    initial: "A",
    avatarClass: "bg-gradient-to-br from-[#e7c49b] to-[#c65a2e]"
  },
  {
    key: "pm",
    name: "Juno",
    role: "Product Manager",
    model: "claude-haiku-4-5",
    bio: "Takes Ana's notes and drafts three tightly scoped, demoable issue candidates with acceptance criteria.",
    initial: "J",
    avatarClass: "bg-gradient-to-br from-[#efd48e] to-[#a06a1a]"
  },
  {
    key: "head",
    name: "Rex",
    role: "Head of Product",
    model: "claude-sonnet-4-5",
    bio: "Reads Ana and Juno, disagrees when needed, ranks the top three candidates P1 to P3 and files the issues.",
    initial: "R",
    avatarClass: "bg-gradient-to-br from-[#bcc8a8] to-[#5f724a]"
  }
];

const RANK_ROMAN = ["I", "II", "III"];
const RANK_COLOR = ["#c65a2e", "#a06a1a", "#5f724a"];
const RANK_LABEL: Record<IssuePriority, string> = {
  P1: "Highest",
  P2: "Next up",
  P3: "Nice to have"
};

function firstSentence(text: string, fallback: string, maxLen = 200) {
  if (!text) return fallback;
  const trimmed = text.trim();
  const match = trimmed.match(/^([^\n.]+[.!?])/);
  const candidate = (match?.[1] ?? trimmed).trim();
  if (candidate.length <= maxLen) return candidate;
  return candidate.slice(0, maxLen - 1).trimEnd() + "…";
}

export function RunForm() {
  const [hasHydrated, setHasHydrated] = useState(false);
  const [productDocument, setProductDocument] = useState("");
  const [productDocumentDraft, setProductDocumentDraft] = useState(DEFAULT_PRODUCT_MD);
  const [isEditingProductDocument, setIsEditingProductDocument] = useState(false);
  const [problem, setProblem] = useState(EXAMPLE_PROBLEMS[0]);
  const [result, setResult] = useState<ProductTeamRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentKey | null>(null);
  const submissionInFlightRef = useRef(false);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(PRODUCT_MD_STORAGE_KEY)?.trim();
    if (saved) {
      setProductDocument(saved);
      setProductDocumentDraft(saved);
    }
    setHasHydrated(true);

    return () => {
      if (stageTimerRef.current) clearTimeout(stageTimerRef.current);
    };
  }, []);

  function saveProductDocument(next: string) {
    const normalized = next.trim();
    setProductDocument(normalized);
    setProductDocumentDraft(normalized || DEFAULT_PRODUCT_MD);
    window.localStorage.setItem(PRODUCT_MD_STORAGE_KEY, normalized);
  }

  function handleSaveProductDocument() {
    if (!productDocumentDraft.trim()) {
      setError("product.md is required");
      return;
    }
    saveProductDocument(productDocumentDraft);
    setIsEditingProductDocument(false);
    setError(null);
  }

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

    if (!productDocument.trim()) {
      setError("Save product.md before convening the team.");
      return;
    }
    if (!problem.trim()) {
      setError("Add a product problem to triage.");
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
        body: JSON.stringify({ product_md: productDocument, problem })
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
    <>
      <Masthead />

      <section className="mx-auto max-w-6xl px-6 pb-40 pt-12 lg:px-8 lg:pt-16">
        {!hasHydrated ? (
          <LoadingState />
        ) : !productDocument ? (
          <ProductDocumentSetup
            productDocumentDraft={productDocumentDraft}
            setProductDocumentDraft={setProductDocumentDraft}
            onSubmit={handleSaveProductDocument}
            error={error}
          />
        ) : (
          <>
            <HeroAndBrief
              problem={problem}
              setProblem={setProblem}
              isSubmitting={isSubmitting}
              productDocument={productDocument}
              productDocumentDraft={productDocumentDraft}
              setProductDocumentDraft={setProductDocumentDraft}
              isEditingProductDocument={isEditingProductDocument}
              setIsEditingProductDocument={setIsEditingProductDocument}
              onSaveProductDocument={handleSaveProductDocument}
            />

            <TeamRoster agentState={agentState} result={result} />

            <StandupOutput
              result={result}
              isSubmitting={isSubmitting}
              error={error}
            />
          </>
        )}
      </section>

      {productDocument ? (
        <Composer
          problem={problem}
          setProblem={setProblem}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          error={error}
        />
      ) : null}
    </>
  );
}

function Masthead() {
  return (
    <header className="border-b border-[#1a181533]">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 lg:px-8">
        <div className="flex items-baseline gap-3">
          <span className="serif text-2xl italic">
            ProductTeam<span className="text-[#c65a2e]">.ai</span>
          </span>
          <span className="mono hidden text-[10px] uppercase tracking-[0.3em] text-[#7a7264] sm:inline">
            No. 001 · Vol. I
          </span>
        </div>
      </div>
    </header>
  );
}

function LoadingState() {
  return (
    <div className="mono py-24 text-center text-[12px] uppercase tracking-[0.25em] text-[#7a7264]">
      loading saved product context…
    </div>
  );
}

function ProductDocumentSetup(props: {
  productDocumentDraft: string;
  setProductDocumentDraft: (v: string) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  const { productDocumentDraft, setProductDocumentDraft, onSubmit, error } = props;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="mx-auto max-w-4xl"
    >
      <p className="mono text-[11px] uppercase tracking-[0.35em] text-[#c65a2e]">Step 01</p>
      <h1 className="serif mt-6 text-[56px] leading-[0.95] tracking-tight sm:text-[72px]">
        Save your <em>product.md</em>.
      </h1>

      <div className="rule my-8 w-32" />

      <p className="max-w-2xl text-[15.5px] leading-8 text-[#3a342d]">
        <span className="serif italic">product.md</span> is the durable context your team reads on
        every run. We store it in your browser with <span className="mono text-[13px]">localStorage</span>
        so you only do this once. Write what the product is, who it is for, the core workflow, and
        any important constraints.
      </p>

      <div className="mt-10 rounded-3xl border border-[#1a181522] bg-white p-6 shadow-[0_40px_80px_-40px_rgba(26,24,21,0.25)]">
        <div className="flex items-center justify-between">
          <span className="mono text-[10px] uppercase tracking-[0.3em] text-[#7a7264]">
            product.md
          </span>
          <span className="mono text-[10px] text-[#b4a99a]">saved locally</span>
        </div>

        <textarea
          value={productDocumentDraft}
          onChange={(e) => setProductDocumentDraft(e.target.value)}
          placeholder="# Product"
          required
          className="mono mt-4 h-[420px] w-full resize-none rounded-2xl border border-[#1a18151a] bg-[#faf7f0] p-4 text-[13px] leading-6 text-[#1a1815] outline-none transition focus:border-[#c65a2e]"
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] leading-5 text-[#7a7264]">
            Keep it short. Ana and Juno read this before every meeting.
          </p>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-[#c65a2e] px-5 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Save product.md and continue →
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-[#c65a2e] bg-[#c65a2e]/[0.06] px-3 py-2 text-[12px] text-[#1a1815]">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function HeroAndBrief(props: {
  problem: string;
  setProblem: (v: string) => void;
  isSubmitting: boolean;
  productDocument: string;
  productDocumentDraft: string;
  setProductDocumentDraft: (v: string) => void;
  isEditingProductDocument: boolean;
  setIsEditingProductDocument: (v: boolean) => void;
  onSaveProductDocument: () => void;
}) {
  const {
    problem,
    setProblem,
    isSubmitting,
    productDocument,
    productDocumentDraft,
    setProductDocumentDraft,
    isEditingProductDocument,
    setIsEditingProductDocument,
    onSaveProductDocument
  } = props;

  return (
    <div className="grid gap-12 lg:grid-cols-[1.3fr_0.9fr]">
      <div>
        <p className="mono text-[11px] uppercase tracking-[0.35em] text-[#7a7264]">
          The Standup Edition
        </p>
        <h1 className="serif mt-6 text-[56px] leading-[0.95] tracking-tight sm:text-[76px]">
          Three teammates.
          <br />
          <em>One</em> standup.
          <br />
          Three shipped issues.
        </h1>

        <div className="rule my-8 w-32" />

        <p className="max-w-xl text-[15.5px] leading-8 text-[#3a342d]">
          <span className="serif italic">Ana, Juno, and Rex</span> read your{" "}
          <span className="mono text-[13px]">product.md</span> plus today's problem, argue about
          priorities, and file three real GitHub issues in your repo before you finish pouring
          coffee.
        </p>

        {/* product.md panel */}
        <div className="mt-8 rounded-2xl border border-[#1a181522] bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="mono text-[10px] uppercase tracking-[0.3em] text-[#7a7264]">
                product.md · saved locally
              </p>
              <p className="serif mt-1 text-[15px] italic text-[#3a342d]">
                {firstSentence(productDocument, "Product context ready.", 120)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setProductDocumentDraft(productDocument);
                setIsEditingProductDocument(!isEditingProductDocument);
              }}
              disabled={isSubmitting}
              className="mono shrink-0 rounded-lg border border-[#1a181522] bg-[#faf7f0] px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-[#5a5248] transition hover:border-[#c65a2e] hover:text-[#c65a2e] disabled:opacity-50"
            >
              {isEditingProductDocument ? "Close" : "Edit"}
            </button>
          </div>

          {isEditingProductDocument ? (
            <div className="mt-4">
              <textarea
                value={productDocumentDraft}
                onChange={(e) => setProductDocumentDraft(e.target.value)}
                disabled={isSubmitting}
                className="mono h-64 w-full resize-none rounded-xl border border-[#1a181522] bg-[#faf7f0] p-3 text-[13px] leading-6 outline-none focus:border-[#c65a2e]"
                required
              />
              <div className="mt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setProductDocumentDraft(productDocument);
                    setIsEditingProductDocument(false);
                  }}
                  disabled={isSubmitting}
                  className="text-[12px] text-[#7a7264] transition hover:text-[#1a1815] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSaveProductDocument}
                  disabled={isSubmitting}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-[#c65a2e] bg-[#c65a2e]/[0.08] px-3 text-[12px] font-semibold text-[#c65a2e] transition hover:bg-[#c65a2e]/[0.14] disabled:opacity-50"
                >
                  Save product.md
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <aside>
        <div className="sticky top-6 rounded-3xl border border-[#1a181522] bg-white p-6 shadow-[0_40px_80px_-40px_rgba(26,24,21,0.25)]">
          <div className="flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-[0.3em] text-[#7a7264]">
              Today's dispatch
            </span>
            <span className="mono text-[10px] text-[#b4a99a]">#brief-live</span>
          </div>

          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            disabled={isSubmitting}
            placeholder="Users sign up but never return after day 3."
            required
            className="serif mt-4 h-32 w-full resize-none rounded-2xl border border-[#1a181520] bg-[#faf7f0] p-4 text-[18px] leading-[1.4] italic text-[#1a1815] outline-none transition focus:border-[#c65a2e] disabled:opacity-60"
          />

          <p className="mono mt-3 text-[10px] uppercase tracking-[0.22em] text-[#b4a99a]">
            Example problems
          </p>
          <div className="mt-2 space-y-1.5">
            {EXAMPLE_PROBLEMS.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setProblem(example)}
                disabled={isSubmitting}
                className="block w-full truncate rounded-md border border-[#1a18150f] bg-[#faf7f0] px-3 py-1.5 text-left text-[12px] text-[#5a5248] transition hover:border-[#c65a2e] hover:text-[#c65a2e] disabled:opacity-50"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function TeamRoster({
  agentState,
  result
}: {
  agentState: (key: AgentKey) => AgentState;
  result: ProductTeamRunResult | null;
}) {
  return (
    <section className="mt-20">
      <div className="flex items-end justify-between">
        <div>
          <p className="mono text-[11px] uppercase tracking-[0.35em] text-[#7a7264]">
            Meet the team
          </p>
          <h2 className="serif mt-3 text-3xl sm:text-4xl">
            Three teammates. <em>Three models.</em>
          </h2>
        </div>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {AGENTS.map((agent) => {
          const state = agentState(agent.key);
          const note =
            result && agent.key === "researcher"
              ? firstSentence(result.user_researcher_notes, agent.bio)
              : result && agent.key === "pm"
              ? firstSentence(result.pm_notes, agent.bio)
              : result && agent.key === "head"
              ? `Ranked ${result.issues.length} issues · ${result.issues[0]?.priority ?? "P1"} to ${
                  result.issues[result.issues.length - 1]?.priority ?? "P3"
                }. Filed in GitHub.`
              : agent.bio;

          return (
            <article
              key={agent.key}
              className={`fade-in-up rounded-2xl border bg-white p-5 transition-all ${
                state === "active"
                  ? "border-[#c65a2e] shadow-[0_0_0_4px_rgba(198,90,46,0.08)]"
                  : "border-[#1a181522]"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-11 w-11 items-center justify-center rounded-full text-white text-[15px] font-semibold ${agent.avatarClass}`}
                  >
                    {agent.initial}
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-[#1a1815]">{agent.name}</p>
                    <p className="text-[11px] text-[#7a7264]">{agent.role}</p>
                  </div>
                </div>
                <AgentStatus state={state} />
              </div>

              <p className="mono mt-4 text-[10px] uppercase tracking-[0.22em] text-[#7a7264]">
                {agent.model}
              </p>

              <p className="mt-3 text-[13px] leading-6 text-[#3a342d]">{note}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AgentStatus({ state }: { state: AgentState }) {
  if (state === "active") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1">
          <span className="typing-dot h-1 w-1 rounded-full bg-[#c65a2e]" />
          <span className="typing-dot h-1 w-1 rounded-full bg-[#c65a2e]" />
          <span className="typing-dot h-1 w-1 rounded-full bg-[#c65a2e]" />
        </span>
        <span className="mono text-[10px] uppercase tracking-[0.2em] text-[#c65a2e]">
          Working
        </span>
      </div>
    );
  }
  if (state === "done") {
    return (
      <span className="mono text-[10px] uppercase tracking-[0.2em] text-[#5f724a]">Done</span>
    );
  }
  return (
    <span className="mono text-[10px] uppercase tracking-[0.2em] text-[#b4a99a]">Standing by</span>
  );
}

function StandupOutput({
  result,
  isSubmitting,
  error
}: {
  result: ProductTeamRunResult | null;
  isSubmitting: boolean;
  error: string | null;
}) {
  return (
    <section className="mt-24">
      <div className="flex items-end justify-between">
        <div>
          <p className="mono text-[11px] uppercase tracking-[0.35em] text-[#7a7264]">
            Standup output
          </p>
          <h2 className="serif mt-3 text-3xl sm:text-4xl">
            {result ? (
              <>
                The team filed <em>three</em> issues.
              </>
            ) : isSubmitting ? (
              <>
                The team is <em>in session</em>…
              </>
            ) : (
              <>
                Waiting on <em>the next brief</em>.
              </>
            )}
          </h2>
        </div>
        {result ? (
          <p className="mono hidden text-[11px] text-[#7a7264] sm:block">
            ashish921998/product-team · just now
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-8 rounded-2xl border border-[#c65a2e] bg-[#c65a2e]/[0.05] px-5 py-4 text-[13.5px] text-[#1a1815]">
          <span className="mono mr-2 text-[11px] uppercase tracking-[0.2em] text-[#c65a2e]">
            Error
          </span>
          {error}
        </div>
      ) : null}

      {!result ? (
        <div className="mt-10 space-y-0">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`grid grid-cols-[48px_1fr_160px_80px] items-start gap-6 border-t border-[#1a181522] py-6 ${
                isSubmitting ? "opacity-70" : "opacity-40"
              }`}
            >
              <span className="serif text-4xl italic text-[#b4a99a]">{RANK_ROMAN[i]}</span>
              <div>
                <div className="h-4 w-3/4 rounded bg-[#1a18150a]" />
                <div className="mt-3 h-3 w-5/6 rounded bg-[#1a181508]" />
                <div className="mt-2 h-3 w-2/3 rounded bg-[#1a181508]" />
              </div>
              <span className="mono text-[10px] uppercase tracking-[0.18em] text-[#b4a99a]">
                P{i + 1} · {RANK_LABEL[`P${i + 1}` as IssuePriority]}
              </span>
              <span className="mono justify-self-end text-[11px] text-[#b4a99a]">— —</span>
            </div>
          ))}
          <div className="border-t border-[#1a181522]" />
          <p className="mono mt-4 text-[11px] text-[#7a7264]">
            {isSubmitting
              ? "Three issues materializing…"
              : "Drop a brief below. Ana takes it from there."}
          </p>
        </div>
      ) : (
        <div className="mt-10">
          {result.issues.map((issue, i) => (
            <StandupRow
              key={result.created_issues[i].url}
              index={i}
              issue={issue}
              number={result.created_issues[i].number}
              url={result.created_issues[i].url}
            />
          ))}
          <div className="border-t border-[#1a181522]" />
          <p className="mono mt-5 text-[11px] leading-5 text-[#7a7264]">
            ✓ {result.issues.length} issues filed in ashish921998/product-team · Ana, Juno, and Rex
            closed out the standup.
          </p>
        </div>
      )}
    </section>
  );
}

function StandupRow({
  index,
  issue,
  number,
  url
}: {
  index: number;
  issue: IssueDraft;
  number: number;
  url: string;
}) {
  const rankColor = RANK_COLOR[index] ?? "#1a1815";
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="fade-in-up group grid grid-cols-[48px_1fr_160px_80px] items-start gap-6 border-t border-[#1a181522] py-6 transition hover:bg-[#1a181504]"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <span className="serif text-5xl italic" style={{ color: rankColor }}>
        {RANK_ROMAN[index]}
      </span>
      <div>
        <p className="serif text-[22px] leading-[1.2] text-[#1a1815]">{issue.title}</p>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-[#3a342d]">{issue.why}</p>
        {issue.acceptance_criteria.length > 0 ? (
          <p className="mono mt-2 text-[11px] leading-5 text-[#7a7264]">
            acceptance · {issue.acceptance_criteria[0]}
          </p>
        ) : null}
      </div>
      <span
        className="justify-self-start rounded-full border px-3 py-1 text-[11px] font-semibold"
        style={{ color: rankColor, borderColor: rankColor, backgroundColor: `${rankColor}0f` }}
      >
        {issue.priority} · {RANK_LABEL[issue.priority]}
      </span>
      <span className="mono justify-self-end text-[12px] text-[#7a7264] transition group-hover:text-[#c65a2e]">
        #{number} →
      </span>
    </a>
  );
}

function Composer({
  problem,
  setProblem,
  onSubmit,
  isSubmitting,
  error
}: {
  problem: string;
  setProblem: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[#1a181533] bg-[#faf7f0]/95 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
        <span className="mono hidden text-[11px] uppercase tracking-[0.25em] text-[#7a7264] sm:block">
          Drop today's problem →
        </span>
        <div className="flex-1 rounded-2xl border border-[#1a18153d] bg-white focus-within:border-[#c65a2e]">
          <textarea
            rows={1}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            disabled={isSubmitting}
            required
            placeholder="One product problem. Ana, Juno, and Rex take it from there."
            className="block w-full resize-none bg-transparent px-4 py-3 text-sm text-[#1a1815] outline-none placeholder:text-[#b4a99a] disabled:opacity-60"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
              }
            }}
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-[#c65a2e] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Convening…" : "Convene the team →"}
        </button>
      </div>
      {error ? (
        <p className="mx-auto max-w-4xl px-6 pb-3 text-[11px] text-[#c65a2e]">{error}</p>
      ) : null}
    </form>
  );
}
