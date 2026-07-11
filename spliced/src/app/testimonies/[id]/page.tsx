"use client";
// Testimony detail — raw/AI panes + ClaimBreakdown (derived coverage) + source context + reject/restore
import { useState, use } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import { dayToIso, isoToDay } from "@/lib/client/date";
import { ClaimBreakdown } from "@/components/testimony/ClaimBreakdown";
import { SourceContextPanel } from "@/components/testimony/SourceContextPanel";
import type { Assessment, TestimonyRecord } from "@/lib/types";

export default function TestimonyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const newsroomId = useAppStore((s) => s.newsroomId);
  const qc = useQueryClient();

  const { data: t } = useQuery<TestimonyRecord>({
    queryKey: ["testimony", newsroomId, id],
    queryFn: () => api<TestimonyRecord>(`/api/testimonies/${id}`),
    enabled: !!newsroomId,
    refetchInterval: (q) => {
      const s = q.state.data?.analysis_status;
      return s === "pending" || s === "running" ? 2000 : false;
    },
  });

  const { data: assessment } = useQuery<Assessment>({
    queryKey: ["assessment", newsroomId, id, t?.analysis_status, t?.status],
    queryFn: () => api<Assessment>(`/api/testimonies/${id}/assessment`),
    enabled: !!newsroomId && t?.analysis_status === "done",
  });

  const statusMut = useMutation({
    mutationFn: (action: "reject" | "restore") =>
      api(`/api/testimonies/${id}/${action}`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  // ---- edit: raw text + the date the testimony was given ----
  // The draft is seeded when the editor opens, not synced from an effect: the
  // fetched testimony re-renders on every poll and would clobber what you typed.
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const openEditor = (rec: TestimonyRecord) => {
    setDraftText(rec.raw_text);
    setDraftDate(isoToDay(rec.given_at));
    setEditing(true);
  };

  const editMut = useMutation({
    mutationFn: () =>
      api(`/api/testimonies/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ raw_text: draftText, given_at: dayToIso(draftDate) }),
      }),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries();
    },
  });

  if (!t) return <div className="p-6 text-sm text-muted">Loading…</div>;

  const analyzing = t.analysis_status === "pending" || t.analysis_status === "running";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold">
            {t.ai_title ?? "Testimony awaiting analysis"}
          </h1>
          <p className="text-xs text-muted">
            Source: {t.source_label} ({t.source_role ?? "?"}) · given{" "}
            {t.given_at ? t.given_at.slice(0, 10) : "date unknown"} · entered{" "}
            {t.created_at}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => (editing ? setEditing(false) : openEditor(t))}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#1971C2] hover:text-[#1971C2]"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={() => statusMut.mutate(t.status === "rejected" ? "restore" : "reject")}
            disabled={statusMut.isPending}
            className={`rounded px-3 py-1.5 text-xs font-semibold ${
              t.status === "rejected"
                ? "bg-slate-200 text-slate-700 hover:bg-slate-300"
                : "bg-red-600 text-white hover:bg-red-700"
            }`}
          >
            {t.status === "rejected" ? "Restore" : "Reject"}
          </button>
        </div>
      </div>

      {editing && (
        <section className="mb-4 rounded-lg border border-[#1971C2] bg-panel p-4">
          <label className="mb-1 block text-xs text-muted">Date of testimony</label>
          <input
            type="date"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
            className="rounded border border-border-dim bg-panel px-3 py-2 text-sm focus:border-[#1971C2] focus:outline-none"
          />
          <label className="mb-1 mt-3 block text-xs text-muted">Raw text</label>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            className="h-40 w-full resize-y rounded border border-border-dim bg-panel px-3 py-2 text-sm focus:border-[#1971C2] focus:outline-none"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              disabled={!draftText.trim() || editMut.isPending}
              onClick={() => editMut.mutate()}
              className="rounded bg-[#1971C2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1257A0] disabled:opacity-40"
            >
              {editMut.isPending ? "Saving…" : "Save"}
            </button>
            {editMut.isError && (
              <span className="text-xs text-red-600">
                {(editMut.error as Error).message}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            Changing the raw text discards the extracted claims and re-runs the pipeline;
            changing only the date keeps them. Either way conflict analysis re-runs across
            the whole investigation, so stale contradictions clear themselves.
          </p>
        </section>
      )}

      {t.status === "rejected" && (
        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
          This testimony is rejected and excluded from the accepted narrative and all
          read-time aggregates. No stored score is edited — derived values simply
          change on the next read (§0.1).
        </div>
      )}

      {analyzing && (
        <div className="mb-4 animate-pulse rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700">
          AI pipeline running (extract → resolve → consistency → summarize)…
        </div>
      )}
      {t.analysis_status === "failed" && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-xs text-red-700">
          Analysis failed — check the LLM provider config (OPENAI_API_KEY in .env.local).
        </div>
      )}

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border-dim bg-panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-muted">Raw text (canonical)</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {t.raw_text}
          </p>
        </section>
        <section className="rounded-lg border border-border-dim bg-panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-muted">
            AI summary (grounded in raw text only)
          </h3>
          <p className="text-sm leading-relaxed text-slate-700">
            {t.ai_summary ?? "—"}
          </p>
          {t.ai_detail && (
            <p className="mt-2 border-t border-border-dim pt-2 text-xs leading-relaxed text-muted">
              {t.ai_detail}
            </p>
          )}
        </section>
      </div>

      {assessment && (
        <div className="flex flex-col gap-4">
          <ClaimBreakdown assessment={assessment} />
          {assessment.conflicts.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-red-700">
                ⚡ Conflicting testimonies: {assessment.conflicts.length}
              </h3>
              {assessment.conflicts.map((c, i) => (
                <a
                  key={i}
                  href={`/testimonies/${c.with_testimony}`}
                  className="block text-xs text-red-700 hover:underline"
                >
                  → {c.type} relationship with claim &ldquo;{c.claim}&rdquo;
                </a>
              ))}
            </div>
          )}
          {assessment.source_context && (
            <SourceContextPanel context={assessment.source_context} />
          )}
        </div>
      )}
    </div>
  );
}
