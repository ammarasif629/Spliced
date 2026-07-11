"use client";
// Source context — cited attributes only, never a score (defamation defense).
import type { SourceContext } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = {
  proximity: "Proximity",
  conflict_of_interest: "Conflict of interest",
  expertise: "Expertise",
  prior_record: "Prior record",
};

export function SourceContextPanel({ context }: { context: SourceContext }) {
  return (
    <div className="rounded-lg border border-border-dim bg-panel p-4">
      <h3 className="text-sm font-semibold">
        Source: {context.label}
        {context.role && (
          <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted">
            {context.role}
          </span>
        )}
      </h3>
      <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
        ⚠ This panel is editorial context with citations — it is not a trust score.
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {context.attributes.length === 0 && (
          <p className="text-[11px] text-muted">No context recorded yet.</p>
        )}
        {context.attributes.map((a) => (
          <div key={a.id} className="rounded border border-border-dim bg-background p-2 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-[#1971C2]">
                {CATEGORY_LABEL[a.category] ?? a.category}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  a.is_allegation
                    ? "bg-amber-50 text-amber-700"
                    : "bg-green-50 text-green-700"
                }`}
              >
                {a.is_allegation ? "Allegation" : "Verified fact"}
              </span>
              {a.verified_by_name && (
                <span className="text-[10px] text-muted">
                  Signed off: {a.verified_by_name}
                </span>
              )}
            </div>
            <p className="mt-1 text-slate-700">{a.statement}</p>
            {a.citation_url && (
              <a
                href={a.citation_url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#1971C2] hover:underline"
              >
                🔗 Citation {a.citation_note ? `(${a.citation_note})` : ""}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
