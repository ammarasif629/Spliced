"use client";
// Starred sidebar — pinned "hot" billboards/boards, organized into custom-named groups.
// Clicking an item focuses it in the viewport; items can be moved between groups.
import { useState } from "react";
import { useAppStore } from "@/lib/client/store";
import { computeLayout, TILT_2D } from "./TimePlaneCanvas";
import type { GraphPayload } from "@/lib/types";
import { t } from "@/lib/i18n/en";

export function StarredPanel({ graph }: { graph: GraphPayload }) {
  const {
    starGroups,
    toggleStar,
    createStarGroup,
    deleteStarGroup,
    moveStar,
    requestFocus,
    cardPositions,
    minimizedPlanes,
    hiddenPlanes,
    viewMode,
    pageGap,
  } = useAppStore();
  const [newName, setNewName] = useState("");

  // must mirror what the viewport draws, or "Focus" flies to the wrong point
  const { positions, poses } = computeLayout(graph, {
    cardPositions,
    minimized: minimizedPlanes,
    hidden: hiddenPlanes,
    gap: pageGap,
    tilt: viewMode === "2d" ? TILT_2D : 0,
  });

  const labelOf = (id: string): { label: string; kind: "board" | "billboard" } | null => {
    const plane = graph.planes.find((p) => p.id === id);
    if (plane) return { label: plane.title, kind: "board" };
    const claim = graph.claims.find((c) => c.id === id);
    if (claim)
      return {
        label: claim.text.length > 44 ? claim.text.slice(0, 44) + "…" : claim.text,
        kind: "billboard",
      };
    return null;
  };

  const focusItem = (id: string) => {
    if (positions[id]) requestFocus(positions[id]);
    else if (poses[id]) requestFocus(poses[id].position);
  };

  const totalStars = starGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex flex-col gap-2 p-3">
      {totalStars === 0 && starGroups.length === 0 && (
        <p className="text-[10px] italic text-muted">{t("star.empty")}</p>
      )}

      {starGroups.map((g) => (
        <div key={g.id} className="rounded border border-border-dim bg-background">
          <div className="flex items-center gap-1 border-b border-border-dim px-2 py-1">
            <span className="text-[11px] font-semibold text-slate-700">
              ★ {g.name}
            </span>
            <span className="text-[9px] text-muted">({g.items.length})</span>
            <button
              title={t("star.deleteGroup")}
              onClick={() => deleteStarGroup(g.id)}
              className="ml-auto rounded px-1 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-red-600"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-1 p-1.5">
            {g.items.length === 0 && (
              <p className="px-1 text-[9px] italic text-muted">Empty</p>
            )}
            {g.items.map((id) => {
              const info = labelOf(id);
              if (!info) return null;
              return (
                <div
                  key={id}
                  className="group flex items-center gap-1 rounded border border-border-dim bg-panel px-1.5 py-1"
                >
                  <button
                    title={t("star.focus")}
                    onClick={() => focusItem(id)}
                    className="min-w-0 flex-1 truncate text-left text-[10px] text-slate-700 hover:text-[#1971C2]"
                  >
                    <span className="mr-1 text-[9px] text-muted">
                      {info.kind === "board" ? "▣" : "❝"}
                    </span>
                    {info.label}
                  </button>
                  {starGroups.length > 1 && (
                    <select
                      title="Move to group"
                      className="w-4 shrink-0 cursor-pointer border-0 bg-transparent text-[9px] text-slate-400"
                      value=""
                      onChange={(e) => e.target.value && moveStar(id, e.target.value)}
                    >
                      <option value="">⇄</option>
                      {starGroups
                        .filter((o) => o.id !== g.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    title="Unstar"
                    onClick={() => toggleStar(id)}
                    className="shrink-0 text-[10px] text-amber-500 hover:text-slate-400"
                  >
                    ★
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex gap-1">
        <input
          className="min-w-0 flex-1 rounded border border-border-dim bg-background px-2 py-1 text-[10px] focus:border-[#1971C2] focus:outline-none"
          placeholder={t("star.newGroup")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) {
              createStarGroup(newName.trim());
              setNewName("");
            }
          }}
        />
        <button
          disabled={!newName.trim()}
          onClick={() => {
            createStarGroup(newName.trim());
            setNewName("");
          }}
          className="rounded bg-[#1971C2] px-2 py-1 text-[10px] font-semibold text-white hover:bg-[#1257A0] disabled:opacity-40"
        >
          {t("star.create")}
        </button>
      </div>
    </div>
  );
}
