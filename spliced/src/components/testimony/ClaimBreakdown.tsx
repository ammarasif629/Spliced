"use client";
// Coverage bar (NOT a person score) + per-claim status + separated badges (§8)
import type { Assessment } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  corroborated: "bg-green-50 text-green-700 border-green-300",
  contested: "bg-amber-50 text-amber-700 border-amber-300",
  refuted: "bg-red-50 text-red-700 border-red-300",
  uncorroborated: "bg-slate-100 text-slate-500 border-slate-300",
};

const STATUS_LABEL: Record<string, string> = {
  corroborated: "Corroborated",
  contested: "Contested",
  refuted: "Refuted",
  uncorroborated: "Uncorroborated",
};

export function ClaimBreakdown({ assessment }: { assessment: Assessment }) {
  const pct = Math.round(assessment.corroboration_coverage * 100);
  const corroborated = assessment.claim_breakdown.filter(
    (c) => c.status === "corroborated"
  ).length;

  return (
    <div className="rounded-lg border border-border-dim bg-panel p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Corroboration Coverage</h3>
        <span className="text-lg font-bold text-[#1971C2]">{pct}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded bg-slate-100">
        <div
          className="h-full rounded bg-[#1971C2] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {corroborated} of {assessment.claim_breakdown.length} claims corroborated —
        derived from links at read time (never stored).
      </p>

      {/* badges: non-quantifiable axes are never merged into the number (§8) */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {assessment.coherence_badges.map((b) => (
          <span
            key={b}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${
              b.startsWith("⚠")
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-green-300 bg-green-50 text-green-700"
            }`}
          >
            {b}
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {assessment.claim_breakdown.map((c) => (
          <div
            key={c.claim_id}
            className="flex items-center gap-2 rounded border border-border-dim bg-background p-2"
          >
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[c.status]}`}
            >
              {STATUS_LABEL[c.status]}
            </span>
            <span className="flex-1 text-[11px] text-slate-700">{c.claim}</span>
            <span className="shrink-0 text-[10px] text-muted">
              supports {c.supporting_evidence} · contradicts {c.contradicting}
              {c.has_direct_evidence && " · 📄"}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] italic text-muted">{assessment.disclaimer}</p>
    </div>
  );
}
