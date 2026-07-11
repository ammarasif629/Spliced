"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import { SourceContextPanel } from "@/components/testimony/SourceContextPanel";
import type { SourceContext } from "@/lib/types";

interface SourceOption { id: string; role: string | null; label: string }

export default function SourcesPage() {
  const newsroomId = useAppStore((s) => s.newsroomId);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: "proximity",
    statement: "",
    citation_url: "",
    is_allegation: true,
  });

  const { data: sources } = useQuery<SourceOption[]>({
    queryKey: ["sources", newsroomId],
    queryFn: () => api<SourceOption[]>("/api/sources"),
    enabled: !!newsroomId,
  });

  const { data: context } = useQuery<SourceContext>({
    queryKey: ["source-context", newsroomId, selected],
    queryFn: () => api<SourceContext>(`/api/sources/${selected}/context`),
    enabled: !!newsroomId && !!selected,
  });

  const addAttr = useMutation({
    mutationFn: () =>
      api(`/api/sources/${selected}/attributes`, {
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["source-context"] });
      setForm({ ...form, statement: "", citation_url: "" });
    },
  });

  const input =
    "w-full rounded border border-border-dim bg-background px-2 py-1.5 text-xs focus:border-[#1971C2] focus:outline-none";

  return (
    <div className="flex h-full">
      <div className="w-72 shrink-0 overflow-auto border-r border-border-dim bg-panel p-3">
        <h1 className="mb-3 text-sm font-bold">Sources</h1>
        {(sources ?? []).map((s) => (
          <button
            key={s.id}
            onClick={() => setSelected(s.id)}
            className={`mb-1 block w-full rounded px-3 py-2 text-left text-xs ${
              selected === s.id
                ? "bg-blue-50 text-[#1971C2]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {s.label}
            <span className="ml-2 text-[10px] text-muted">{s.role}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {!context ? (
          <p className="text-sm text-muted">
            Select a source on the left. Sources have no scores — only editorial
            context with citations (§0.1).
          </p>
        ) : (
          <div className="mx-auto flex max-w-xl flex-col gap-4">
            <SourceContextPanel context={context} />

            <div className="rounded-lg border border-border-dim bg-panel p-4">
              <h3 className="mb-2 text-sm font-semibold">+ Add attribute (citation required)</h3>
              <div className="flex flex-col gap-2">
                <select
                  className={input}
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                >
                  {["proximity", "conflict_of_interest", "expertise", "prior_record"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <textarea
                  className={`${input} h-16`}
                  placeholder="Statement (e.g. Our reporting confirmed employment at the agency in 2019)"
                  value={form.statement}
                  onChange={(e) => setForm({ ...form, statement: e.target.value })}
                />
                <input
                  className={input}
                  placeholder="Citation URL"
                  value={form.citation_url}
                  onChange={(e) => setForm({ ...form, citation_url: e.target.value })}
                />
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={form.is_allegation}
                    onChange={(e) => setForm({ ...form, is_allegation: e.target.checked })}
                  />
                  Mark as allegation — uncheck only for verified facts
                </label>
                <button
                  disabled={!form.statement.trim() || addAttr.isPending}
                  onClick={() => addAttr.mutate()}
                  className="self-start rounded bg-[#1971C2] px-3 py-1.5 text-xs text-white hover:bg-[#1257A0] disabled:opacity-40"
                >
                  Add
                </button>
                {addAttr.isError && (
                  <p className="text-[10px] text-red-600">{(addAttr.error as Error).message}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
