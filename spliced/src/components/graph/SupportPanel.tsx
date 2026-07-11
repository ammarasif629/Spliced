"use client";
// Phase 6 — layered disclosure. Aggregates by default; details open on demand.
// Never spawns nodes into the graph.
import { useState } from "react";
import Link from "next/link";
import type { GraphPayload } from "@/lib/types";
import type { ClaimAggregate } from "./TimePlaneCanvas";
import { t } from "@/lib/i18n/en";

export function SupportPanel({
  graph,
  claimId,
  aggregates,
}: {
  graph: GraphPayload;
  claimId: string;
  aggregates: Record<string, ClaimAggregate>;
}) {
  const [open, setOpen] = useState(false);
  const claim = graph.claims.find((c) => c.id === claimId);
  const agg = aggregates[claimId];
  if (!claim || !agg) return null;

  const supporting = graph.links
    .filter((l) => l.kind === "supports" && l.to_claim === claimId)
    .map((l) => graph.claims.find((c) => c.id === l.from_claim))
    .filter(Boolean) as GraphPayload["claims"];
  const contradicting = graph.links
    .filter(
      (l) =>
        l.kind === "contradicts" &&
        (l.to_claim === claimId || l.from_claim === claimId)
    )
    .map((l) =>
      graph.claims.find(
        (c) => c.id === (l.from_claim === claimId ? l.to_claim : l.from_claim)
      )
    )
    .filter(Boolean) as GraphPayload["claims"];
  const documents = graph.links
    .filter((l) => l.kind === "direct_evidence" && l.from_claim === claimId)
    .map((l) => graph.evidence.find((e) => e.id === l.evidence_id))
    .filter(Boolean) as GraphPayload["evidence"];

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs leading-snug text-slate-700">{claim.text}</p>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Stat label={t("support.supports")} value={String(agg.supports)} />
        <Stat label={t("support.agreement")} value={`${agg.agreement}%`} />
        <Stat label={t("support.confidence")} value={agg.confidence} />
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded bg-[#1971C2] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#1257A0]"
      >
        {open ? "Hide Supporting Evidence" : t("support.viewEvidence")}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          <Section title={t("support.testimonies")}>
            {supporting.length === 0 && <Empty />}
            {supporting.map((c) => (
              <Row key={c.id} href={`/testimonies/${c.testimony_id}`}>
                {c.text} <span className="text-muted">— {c.source_label}</span>
              </Row>
            ))}
          </Section>
          <Section title={t("support.contradicting")}>
            {contradicting.length === 0 && <Empty />}
            {contradicting.map((c) => (
              <Row key={c.id} href={`/testimonies/${c.testimony_id}`}>
                {c.text} <span className="text-muted">— {c.source_label}</span>
              </Row>
            ))}
          </Section>
          <Section title={t("support.documents")}>
            {documents.length === 0 && <Empty />}
            {documents.map((e) => (
              <div
                key={e.id}
                className="rounded border border-border-dim bg-background p-1.5 text-[11px] text-slate-700"
              >
                📄 {e.title ?? e.id}
                {e.provenance && (
                  <span className="ml-1 text-[10px] text-muted">({e.provenance})</span>
                )}
              </div>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border-dim bg-background px-1 py-1.5">
      <div className="text-sm font-bold text-[#1971C2]">{value}</div>
      <div className="text-[9px] text-muted">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h5>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Row({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded border border-border-dim bg-background p-1.5 text-[11px] text-slate-700 hover:border-[#1971C2]"
    >
      {children}
    </Link>
  );
}

function Empty() {
  return <p className="text-[10px] italic text-muted">{t("support.none")}</p>;
}
