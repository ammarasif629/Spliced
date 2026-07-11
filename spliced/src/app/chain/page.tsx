"use client";
// Accepted chain — the narrative reconstructed from active testimonies only
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import type { EventPlane, LinkRecord, EvidenceRecord } from "@/lib/types";

interface ChainClaim {
  id: string; testimony_id: string; text: string; source_label: string;
  coherence_flags: string[]; supporting: number; contradicting: number;
  hasDirectEvidence: boolean;
}
interface ChainPayload {
  chain: { event: EventPlane; claims: ChainClaim[] }[];
  links: LinkRecord[];
  evidence: EvidenceRecord[];
}

export default function ChainPage() {
  const newsroomId = useAppStore((s) => s.newsroomId);
  const { data } = useQuery<ChainPayload>({
    queryKey: ["chain", newsroomId],
    queryFn: () => api<ChainPayload>("/api/graph/accepted-chain"),
    enabled: !!newsroomId,
  });

  if (!data) return <div className="p-6 text-sm text-muted">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-lg font-bold">Accepted Chain</h1>
      <p className="mb-5 mt-1 text-xs text-muted">
        The narrative rebuilt from active (non-rejected) testimonies only. Rejecting a
        testimony changes this chain and coverage on the very next read — a natural
        consequence of derived values, not a stored-score recalculation (§0.1).
      </p>

      <div className="relative border-l-2 border-blue-200 pl-6">
        {data.chain.map(({ event, claims }) => (
          <div key={event.id} className="relative mb-8">
            <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-[#1971C2] bg-background" />
            <div className="text-[11px] text-[#1971C2]">
              {event.occurred_at?.slice(0, 10) ?? "date unknown"}
              <span className="ml-1 text-muted">({event.occurred_precision})</span>
            </div>
            <h2 className="text-sm font-semibold text-slate-800">{event.title}</h2>
            <div className="mt-2 flex flex-col gap-1.5">
              {claims.length === 0 && (
                <p className="text-[11px] italic text-muted">
                  No accepted claims (all rejected or none entered)
                </p>
              )}
              {claims.map((c) => (
                <Link
                  key={c.id}
                  href={`/testimonies/${c.testimony_id}`}
                  className="rounded border border-border-dim bg-panel p-2 text-xs hover:border-[#1971C2]"
                >
                  <span className="text-slate-700">{c.text}</span>
                  <div className="mt-1 flex gap-2 text-[10px] text-muted">
                    <span>{c.source_label}</span>
                    {c.hasDirectEvidence && <span className="text-green-600">📄 direct evidence</span>}
                    {c.supporting > 0 && <span className="text-[#1971C2]">supports {c.supporting}</span>}
                    {c.contradicting > 0 && <span className="text-red-600">contradicts {c.contradicting}</span>}
                    {c.coherence_flags.map((f) => (
                      <span key={f} className="text-amber-600">⚠ {f}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
