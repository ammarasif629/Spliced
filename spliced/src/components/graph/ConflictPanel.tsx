"use client";
// Conflict review — rendered directly from the stored LLM analysis document.
// Rejecting a testimony never edits a stored score: derived values change on the next
// read (§0.1), and a rejected claim drops out of the analysis, taking its red line and
// its NON-COHERENT TESTIMONY badge with it.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { analysisOf, conflictPairs } from "@/lib/client/conflicts";
import type { GraphPayload } from "@/lib/types";
import { t } from "@/lib/i18n/en";

export function ConflictPanel({ graph }: { graph: GraphPayload }) {
  const qc = useQueryClient();
  const reject = useMutation({
    mutationFn: (id: string) => api(`/api/testimonies/${id}/reject`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const analysis = analysisOf(graph);
  const conflicts = conflictPairs(graph);

  if (conflicts.length === 0)
    return (
      <div className="p-3">
        <p className="text-[11px] text-muted">{t("conflict.none")}</p>
        {analysis.provider === "mock" && (
          <p className="mt-1.5 text-[10px] leading-snug text-amber-700">
            {t("conflict.noLlm")}
          </p>
        )}
      </div>
    );

  return (
    <div className="flex flex-col gap-2 p-3">
      {conflicts.map((c) => (
        <div key={c.id} className="rounded border border-red-200 bg-red-50 p-2">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[10px] font-bold tracking-wide text-red-600">
              ⚡ {t("conflict.badge")}
            </span>
            {c.dimension && (
              <span className="rounded bg-red-100 px-1 text-[9px] font-semibold uppercase text-red-700">
                {c.dimension}
              </span>
            )}
            {c.confidence != null && (
              <span className="text-[9px] text-red-700">
                {Math.round(c.confidence * 100)}%
              </span>
            )}
            {c.origin === "ai_conflict" && (
              <span className="ml-auto text-[9px] font-semibold text-red-400">LLM</span>
            )}
          </div>
          <p className="mb-1.5 text-[10px] font-semibold text-red-700">
            {c.self ? t("conflict.self") : t("conflict.cross")}
          </p>
          {(
            [
              [c.claim_a, c.text_a, c.witness_a, c.testimony_a],
              [c.claim_b, c.text_b, c.witness_b, c.testimony_b],
            ] as const
          ).map(([claimId, text, witness, testimonyId]) => (
            <div key={claimId} className="mb-1 flex items-start gap-2 text-[11px]">
              <div className="flex-1 text-slate-700">
                {text}
                <span className="ml-1 text-muted">— {witness}</span>
              </div>
              <button
                disabled={reject.isPending}
                onClick={() => reject.mutate(testimonyId)}
                className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white hover:bg-red-700"
              >
                Reject
              </button>
            </div>
          ))}
          {c.reason && (
            <p className="mt-1 border-t border-red-200 pt-1 text-[10px] leading-snug text-red-800">
              {c.reason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
