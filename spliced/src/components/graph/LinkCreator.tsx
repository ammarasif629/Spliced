"use client";
// Journalist manually connects relationships between claims (user flow step 4).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import type { GraphPayload, LinkKind } from "@/lib/types";

const KINDS: { value: LinkKind; label: string }[] = [
  { value: "supports", label: "Supports (blue)" },
  { value: "contradicts", label: "Contradicts (red)" },
  { value: "direct_evidence", label: "Direct evidence (green)" },
  { value: "weak_assoc", label: "Weak association (orange)" },
  { value: "inference", label: "Inference (purple)" },
];

export function LinkCreator({ graph }: { graph: GraphPayload }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState("");
  const [kind, setKind] = useState<LinkKind>("supports");
  const [to, setTo] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api(`/api/claims/${from}/links`, {
        method: "POST",
        body: JSON.stringify(
          kind === "direct_evidence" ? { evidence_id: to, kind } : { to_claim: to, kind }
        ),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["graph"] });
      setFrom(""); setTo("");
    },
  });

  const activeClaims = graph.claims.filter((c) => c.testimony_status === "active");
  const targets =
    kind === "direct_evidence"
      ? graph.evidence.map((e) => ({ id: e.id, label: e.title ?? e.id }))
      : activeClaims
          .filter((c) => c.id !== from)
          .map((c) => ({ id: c.id, label: c.text }));

  const sel =
    "w-full rounded border border-border-dim bg-background px-2 py-1 text-[11px]";

  return (
    <div className="flex flex-col gap-2 p-3">
      <select className={sel} value={from} onChange={(e) => setFrom(e.target.value)}>
        <option value="">Source claim…</option>
        {activeClaims.map((c) => (
          <option key={c.id} value={c.id}>{c.text.slice(0, 40)}</option>
        ))}
      </select>
      <select
        className={sel}
        value={kind}
        onChange={(e) => { setKind(e.target.value as LinkKind); setTo(""); }}
      >
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>
      <select className={sel} value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">
          {kind === "direct_evidence" ? "Select evidence…" : "Target claim…"}
        </option>
        {targets.map((tg) => (
          <option key={tg.id} value={tg.id}>{tg.label.slice(0, 40)}</option>
        ))}
      </select>
      <button
        disabled={!from || !to || create.isPending}
        onClick={() => create.mutate()}
        className="rounded bg-[#1971C2] px-2 py-1 text-xs text-white hover:bg-[#1257A0] disabled:opacity-40"
      >
        {create.isPending ? "Linking…" : "Create link"}
      </button>
      {create.isError && (
        <p className="text-[10px] text-red-600">{(create.error as Error).message}</p>
      )}
    </div>
  );
}
