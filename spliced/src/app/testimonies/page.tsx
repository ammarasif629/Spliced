"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import type { TestimonyRecord } from "@/lib/types";

const ANALYSIS_LABEL: Record<string, string> = {
  pending: "Queued",
  running: "Analyzing…",
  done: "Analyzed",
  failed: "Analysis failed",
};

export default function TestimoniesPage() {
  const newsroomId = useAppStore((s) => s.newsroomId);
  const { data: testimonies } = useQuery<TestimonyRecord[]>({
    queryKey: ["testimonies", newsroomId],
    queryFn: () => api<TestimonyRecord[]>("/api/testimonies"),
    enabled: !!newsroomId,
    refetchInterval: (q) =>
      q.state.data?.some((t) => t.analysis_status === "pending" || t.analysis_status === "running")
        ? 2500
        : false,
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Testimonies</h1>
        <Link
          href="/testimonies/new"
          className="rounded bg-[#1971C2] px-3 py-1.5 text-sm text-white hover:bg-[#1257A0]"
        >
          + Submit testimony
        </Link>
      </div>
      <div className="flex flex-col gap-3">
        {(testimonies ?? []).map((t) => (
          <Link
            key={t.id}
            href={`/testimonies/${t.id}`}
            className={`rounded-lg border border-border-dim bg-panel p-4 transition hover:border-[#1971C2] ${
              t.status === "rejected" ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-sm font-semibold text-slate-800">
                {t.ai_title ?? t.raw_text.slice(0, 40) + "…"}
              </h2>
              {t.status === "rejected" && (
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
                  Rejected
                </span>
              )}
              <span
                className={`rounded px-2 py-0.5 text-[10px] ${
                  t.analysis_status === "done"
                    ? "bg-green-50 text-green-700"
                    : t.analysis_status === "failed"
                    ? "bg-red-50 text-red-700"
                    : "bg-amber-50 text-amber-700 animate-pulse"
                }`}
              >
                {ANALYSIS_LABEL[t.analysis_status]}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted">
              {t.ai_summary ?? t.raw_text}
            </p>
            <div className="mt-2 text-[10px] text-muted">
              {t.source_label} ({t.source_role ?? "?"}) · given{" "}
              {t.given_at ? t.given_at.slice(0, 10) : "date unknown"}
            </div>
          </Link>
        ))}
        {testimonies?.length === 0 && (
          <p className="text-sm text-muted">No testimonies yet.</p>
        )}
      </div>
    </div>
  );
}
