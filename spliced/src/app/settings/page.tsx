"use client";
// LLM settings — the journalist supplies their own ChatGPT-compatible API key.
// The key is stored server-side (data/llm.json, gitignored) and is never sent back
// to the browser; only a four-character hint is shown so you can tell keys apart.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import type { AnalysisDoc } from "@/lib/types";

interface LlmStatus {
  configured: boolean;
  model: string;
  baseUrl: string;
  source: "settings" | "env" | "none";
  keyHint: string | null;
}

interface ReanalyzeResult {
  status: string;
  conflicts: number;
  provider: string;
  model: string;
}

const input =
  "w-full rounded border border-border-dim bg-panel px-3 py-2 text-sm focus:border-[#1971C2] focus:outline-none";

export default function SettingsPage() {
  const newsroomId = useAppStore((s) => s.newsroomId);
  const qc = useQueryClient();

  const { data: status } = useQuery<LlmStatus>({
    queryKey: ["llm-status"],
    queryFn: () => api<LlmStatus>("/api/settings/llm"),
  });
  const { data: analysis } = useQuery<AnalysisDoc>({
    queryKey: ["analysis", newsroomId],
    queryFn: () => api<AnalysisDoc>("/api/analysis"),
    enabled: !!newsroomId,
  });

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api<LlmStatus>("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify({
          ...(apiKey ? { api_key: apiKey } : {}),
          ...(baseUrl ? { base_url: baseUrl } : {}),
          ...(model ? { model } : {}),
        }),
      }),
    onSuccess: () => {
      setApiKey("");
      qc.invalidateQueries();
    },
  });

  const reanalyze = useMutation({
    mutationFn: () => api<ReanalyzeResult>("/api/analysis", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-bold">Settings</h1>
      <p className="mb-6 text-xs text-muted">
        Conflict detection is performed by a large language model reasoning over your
        testimonies. Supply a ChatGPT-compatible API key to enable it.
      </p>

      <section className="rounded-lg border border-border-dim bg-panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold">LLM provider</h2>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              status?.configured
                ? "bg-green-50 text-green-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {status?.configured ? `Connected · ${status.model}` : "Not configured"}
          </span>
        </div>

        {status?.configured && (
          <p className="mb-3 text-[11px] text-muted">
            Key ending in <code className="font-mono">…{status.keyHint}</code>, read from{" "}
            {status.source === "settings" ? "Settings" : "the environment"} · endpoint{" "}
            <code className="font-mono">{status.baseUrl}</code>
          </p>
        )}
        {!status?.configured && (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">
            Without a key no contradiction is ever reported automatically. Deciding
            whether two statements can coexist requires semantic reasoning; a keyword
            heuristic would invent contradictions between claims that merely share
            vocabulary, which is worse than silence in an investigation.
          </p>
        )}

        <label className="mb-1 block text-xs text-muted">API key</label>
        <input
          type="password"
          className={input}
          placeholder={status?.configured ? "•••••••• (leave blank to keep)" : "sk-…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />

        <label className="mb-1 mt-3 block text-xs text-muted">
          Base URL (any ChatGPT-compatible endpoint)
        </label>
        <input
          className={input}
          placeholder={status?.baseUrl ?? "https://api.openai.com/v1"}
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />

        <label className="mb-1 mt-3 block text-xs text-muted">Model</label>
        <input
          className={input}
          placeholder={status?.model ?? "gpt-4o-mini"}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            disabled={save.isPending || (!apiKey && !baseUrl && !model)}
            onClick={() => save.mutate()}
            className="rounded bg-[#1971C2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1257A0] disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : "Save & re-analyze"}
          </button>
          {save.isError && (
            <span className="text-xs text-red-600">{(save.error as Error).message}</span>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border-dim bg-panel p-4">
        <h2 className="mb-2 text-sm font-semibold">Conflict analysis</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Last run</dt>
          <dd>{analysis?.analyzed_at ?? "never"}</dd>
          <dt className="text-muted">Provider / model</dt>
          <dd>
            {analysis?.provider ?? "—"} / {analysis?.model ?? "—"}
          </dd>
          <dt className="text-muted">Active claims</dt>
          <dd>{analysis?.claim_count ?? 0}</dd>
          <dt className="text-muted">Conflicts detected</dt>
          <dd className={analysis?.conflicts.length ? "font-semibold text-red-600" : ""}>
            {analysis?.conflicts.length ?? 0}
          </dd>
        </dl>

        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={reanalyze.isPending}
            onClick={() => reanalyze.mutate()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-[#1971C2] hover:text-[#1971C2] disabled:opacity-40"
          >
            {reanalyze.isPending ? "Analyzing…" : "Re-analyze now"}
          </button>
          {reanalyze.data && (
            <span className="text-xs text-muted">
              {reanalyze.data.status} · {reanalyze.data.conflicts} conflict(s) via{" "}
              {reanalyze.data.provider}
            </span>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          The analysis re-runs automatically whenever a testimony is added, edited,
          deleted, or moved to another date. Unchanged testimonies are never re-sent:
          the run is skipped entirely when nothing the model would see has changed.
        </p>
      </section>
    </div>
  );
}
