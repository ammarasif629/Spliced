"use client";
// User flow step 1 — submit raw text → 202 → async analysis (polled on detail page)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import { dayToIso, today } from "@/lib/client/date";

interface SourceOption { id: string; role: string | null; label: string }

export default function NewTestimonyPage() {
  const router = useRouter();
  const newsroomId = useAppStore((s) => s.newsroomId);
  const [rawText, setRawText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceRole, setNewSourceRole] = useState("witness");
  // the date the witness gave this statement — defaults to today, the common case
  const [givenAt, setGivenAt] = useState(today);

  const { data: sources } = useQuery<SourceOption[]>({
    queryKey: ["sources", newsroomId],
    queryFn: () => api<SourceOption[]>("/api/sources"),
    enabled: !!newsroomId,
  });

  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string }>("/api/testimonies", {
        method: "POST",
        body: JSON.stringify({
          raw_text: rawText,
          given_at: dayToIso(givenAt),
          ...(sourceId
            ? { source_id: sourceId }
            : { new_source_name: newSourceName, new_source_role: newSourceRole }),
        }),
      }),
    onSuccess: (r) => router.push(`/testimonies/${r.id}`),
  });

  const input =
    "w-full rounded border border-border-dim bg-panel px-3 py-2 text-sm focus:border-[#1971C2] focus:outline-none";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-bold">Submit testimony</h1>

      <label className="mb-1 block text-xs text-muted">Source (existing or new)</label>
      <select className={input} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
        <option value="">— Register a new source —</option>
        {(sources ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} ({s.role})
          </option>
        ))}
      </select>

      {!sourceId && (
        <div className="mt-2 flex gap-2">
          <input
            className={input}
            placeholder="Source name (e.g. J. Doe (witness))"
            value={newSourceName}
            onChange={(e) => setNewSourceName(e.target.value)}
          />
          <select
            className="w-44 rounded border border-border-dim bg-panel px-2 text-sm"
            value={newSourceRole}
            onChange={(e) => setNewSourceRole(e.target.value)}
          >
            {["witness", "official", "insider", "document-holder"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      )}

      <label className="mb-1 mt-4 block text-xs text-muted">
        Date of testimony
      </label>
      <input
        type="date"
        className={input}
        value={givenAt}
        onChange={(e) => setGivenAt(e.target.value)}
      />
      <p className="mt-1 text-[10px] text-muted">
        When the statement was given. It anchors relative time references in the text
        (&ldquo;last Tuesday&rdquo;) and feeds timeline placement and conflict analysis.
      </p>

      <label className="mb-1 mt-4 block text-xs text-muted">Raw testimony</label>
      <textarea
        className={`${input} h-48 resize-y`}
        placeholder="Paste the raw testimony. AI will extract claims, run consistency checks, and summarize (it never judges)."
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
      />

      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={!rawText.trim() || (!sourceId && !newSourceName.trim()) || submit.isPending}
          onClick={() => submit.mutate()}
          className="rounded bg-[#1971C2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1257A0] disabled:opacity-40"
        >
          {submit.isPending ? "Submitting…" : "Submit → AI analysis"}
        </button>
        {submit.isError && (
          <span className="text-xs text-red-600">{(submit.error as Error).message}</span>
        )}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        AI only extracts, normalizes, flags inconsistencies, and summarizes. It never
        auto-collects personal data or scores trustworthiness; every flag must cite an
        item stored in the system (§0.2).
      </p>
    </div>
  );
}
