"use client";
// TIME-GRAPH — the sole investigation environment (one continuous world).
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore } from "@/lib/client/store";
import { ConflictPanel } from "@/components/graph/ConflictPanel";
import { LinkCreator } from "@/components/graph/LinkCreator";
import { SupportPanel } from "@/components/graph/SupportPanel";
import { StarredPanel } from "@/components/graph/StarredPanel";
import { WhiteboardWindow } from "@/components/board/WhiteboardWindow";
import { computeAggregates, computeLayout } from "@/components/graph/TimePlaneCanvas";
import { LINK_COLORS, type GraphPayload, type LinkKind } from "@/lib/types";
import { t } from "@/lib/i18n/en";

const TimePlaneCanvas = dynamic(
  () => import("@/components/graph/TimePlaneCanvas").then((m) => m.TimePlaneCanvas),
  { ssr: false, loading: () => <CanvasFallback /> }
);

function CanvasFallback() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted">
      {t("graph.loading")}
    </div>
  );
}

// A page sheet with a chevron leaving it, rather than a bare arrow: the sheet says
// "page", the chevron says which way. Reads as "previous page" / "next page" at a
// glance and cannot be mistaken for a carousel flip or a generic back button.
function PageArrowIcon({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[19px] w-[19px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dir === "prev" ? (
        <>
          <rect x="10" y="3.5" width="11" height="17" rx="2" />
          <path d="M7 8 3 12l4 4" />
        </>
      ) : (
        <>
          <rect x="3" y="3.5" width="11" height="17" rx="2" />
          <path d="m17 8 4 4-4 4" />
        </>
      )}
    </svg>
  );
}

// Prev/next page navigation. Identical chrome for both focus modes — maximized
// isolation and an ordinary selection — so moving between pages feels the same
// wherever you are: arrows on the flanks, a date pill on top, ✕ to leave the mode.
function PageNav({
  idx,
  total,
  date,
  onGo,
  onExit,
  exitTitle,
}: {
  idx: number;
  total: number;
  date: string;
  onGo: (i: number) => void;
  onExit: () => void;
  exitTitle: string;
}) {
  const arrow =
    "absolute top-1/2 z-20 flex h-11 -translate-y-1/2 items-center gap-1.5 rounded-full border border-slate-300 bg-white/95 px-3.5 text-xs font-semibold text-slate-600 shadow-md transition hover:border-[#1971C2] hover:text-[#1971C2] disabled:cursor-default disabled:opacity-25 disabled:hover:border-slate-300 disabled:hover:text-slate-600";
  return (
    <>
      <button
        disabled={idx === 0}
        onClick={() => onGo(idx - 1)}
        title={t("page.prev")}
        aria-label={t("page.prev")}
        className={`${arrow} left-4`}
      >
        <PageArrowIcon dir="prev" />
        {t("page.prevShort")}
      </button>
      <button
        disabled={idx === total - 1}
        onClick={() => onGo(idx + 1)}
        title={t("page.next")}
        aria-label={t("page.next")}
        className={`${arrow} right-4`}
      >
        {t("page.nextShort")}
        <PageArrowIcon dir="next" />
      </button>
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border border-slate-300 bg-white/95 px-4 py-1.5 shadow-md">
        <span className="text-xs font-bold text-slate-800">{date}</span>
        <span className="text-[10px] text-slate-500">
          {idx + 1} / {total}
        </span>
        <button
          onClick={onExit}
          title={exitTitle}
          className="rounded-full px-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-red-600"
        >
          ✕
        </button>
      </div>
    </>
  );
}

const LEGEND: { kind: LinkKind; label: string }[] = [
  { kind: "supports", label: t("graph.legend.supports") },
  { kind: "contradicts", label: t("graph.legend.contradicts") },
  { kind: "direct_evidence", label: t("graph.legend.evidence") },
  { kind: "weak_assoc", label: t("graph.legend.weak") },
  { kind: "inference", label: t("graph.legend.inference") },
];

export default function GraphPage() {
  const {
    newsroomId,
    viewMode,
    setViewMode,
    selection,
    setSelection,
    clearSelection,
    boards,
    openBoard,
    closeBoard,
    setBoardMode,
    requestReset,
    minimizedPlanes,
    restorePlane,
    hidePlane,
    hiddenPlanes,
    maximizedPlane,
    setMaximizedPlane,
    pageGap,
    setPageGap,
    graphVersion,
    bumpGraph,
  } = useAppStore();
  // right inspector lives in a burger drawer — closed by default for a clean view
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const { data: graph, isLoading } = useQuery<GraphPayload>({
    queryKey: ["graph", newsroomId],
    queryFn: () => api<GraphPayload>("/api/graph/full"),
    enabled: !!newsroomId,
  });

  // destructive mutations fired inside the WebGL canvas bump graphVersion —
  // refetch everything (graph, testimonies, …) so the UI reflects the database
  const queryClient = useQueryClient();
  useEffect(() => {
    if (graphVersion > 0) void queryClient.invalidateQueries();
  }, [graphVersion, queryClient]);

  // permanent page deletion from the bottom tab strip (user-confirmed)
  const deletePageFromTab = async (id: string) => {
    if (!window.confirm(t("page.deleteConfirm"))) return;
    try {
      await api(`/api/events/${id}`, { method: "DELETE" });
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    hidePlane(id);
    bumpGraph();
  };

  const aggregates = useMemo(() => (graph ? computeAggregates(graph) : {}), [graph]);

  // ordered pages for prev/next navigation (deleted+minimized skipped)
  const navPlanes = useMemo(() => {
    if (!graph) return [];
    return computeLayout(graph, { hidden: hiddenPlanes }).planes.filter(
      (p) => p.id !== "__orphan__" && !minimizedPlanes.includes(p.id)
    );
  }, [graph, hiddenPlanes, minimizedPlanes]);

  // Navigation follows whichever page currently has focus: the maximized one, or —
  // when nothing is maximized — a singly-selected page. Both get the same controls.
  const focusedPage = maximizedPlane ?? (selection.length === 1 ? selection[0] : null);
  const navIdx = focusedPage ? navPlanes.findIndex((p) => p.id === focusedPage) : -1;
  const navPlane = navIdx >= 0 ? navPlanes[navIdx] : null;

  const goToPage = useCallback(
    (i: number) => {
      if (i < 0 || i >= navPlanes.length) return;
      if (maximizedPlane) setMaximizedPlane(navPlanes[i].id);
      else setSelection([navPlanes[i].id]);
    },
    [navPlanes, maximizedPlane, setMaximizedPlane, setSelection]
  );

  // standard reading direction on a focused page: → next page, ← previous page
  useEffect(() => {
    if (navIdx < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") goToPage(navIdx + 1);
      if (e.key === "ArrowLeft") goToPage(navIdx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navIdx, goToPage]);

  const selectedClaim =
    graph && selection.length === 1
      ? graph.claims.find((c) => c.id === selection[0])
      : undefined;
  const selectedPlane =
    graph && selection.length === 1
      ? graph.planes.find((p) => p.id === selection[0])
      : undefined;

  return (
    <div className="relative flex h-full">
      {/* ===== viewport ===== */}
      <div className="relative min-w-0 flex-1">
        {/* mode toggle — instant, camera-only (Phase 7) */}
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
          <div className="flex overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
            {(["2d", "3d"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-3 py-1 text-xs font-semibold ${
                  viewMode === m ? "bg-[#1971C2] text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {m === "2d" ? t("graph.mode2d") : t("graph.mode3d")}
              </button>
            ))}
          </div>
          {/* Reset Position — recover when the camera drifts too far away */}
          <button
            onClick={requestReset}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-100 hover:text-[#1971C2]"
          >
            ⌖ {t("graph.reset")}
          </button>
          {selection.length > 0 && (
            <span className="rounded bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow-sm">
              {selection.length} selected — press F to frame
            </span>
          )}
        </div>

        {/* ===== bottom-left ambient controls =====
            One column, so nothing has to guess the height of what sits below it:
            page spacing, then the controls hint, then the legend. */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-col items-start gap-1.5">
          {/* page spacing — distance between pages along the timeline.
              Hidden while maximized: there is only one page then. */}
          {!maximizedPlane && (
            <label className="pointer-events-auto flex items-center gap-2 rounded border border-slate-300 bg-white/90 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm backdrop-blur">
              {t("page.spacing")}
              <input
                type="range"
                min={5}
                max={20}
                step={0.5}
                value={pageGap}
                onChange={(e) => setPageGap(Number(e.target.value))}
                className="w-28 accent-[#1971C2]"
              />
            </label>
          )}

          {/* controls hint */}
          <div className="max-w-md rounded bg-white/90 px-3 py-1.5 text-[10px] leading-relaxed text-slate-500 shadow-sm backdrop-blur">
            {t("graph.controls")}
          </div>

          {/* legend */}
          <div className="flex gap-3 rounded bg-white/90 px-3 py-1.5 shadow-sm backdrop-blur">
            {LEGEND.map((l) => (
              <span key={l.kind} className="flex items-center gap-1 text-[10px] text-slate-600">
                <span className="inline-block h-0.5 w-4 rounded" style={{ background: LINK_COLORS[l.kind] }} />
                {l.label}
              </span>
            ))}
          </div>
        </div>

        {isLoading || !graph ? (
          <CanvasFallback />
        ) : (
          <TimePlaneCanvas graph={graph} />
        )}

        {/* ===== focused page (maximized OR selected): prev/next without leaving the view ===== */}
        {navPlane && (
          <PageNav
            idx={navIdx}
            total={navPlanes.length}
            date={navPlane.occurred_at?.slice(0, 10) ?? "Date unknown"}
            onGo={goToPage}
            onExit={() => (maximizedPlane ? setMaximizedPlane(null) : clearSelection())}
            exitTitle={maximizedPlane ? t("page.exitMax") : t("page.deselect")}
          />
        )}

        {/* ===== whiteboard windows layer (multiple visible) ===== */}
        <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
          {graph &&
            boards.map((win) => {
              const plane = graph.planes.find((p) => p.id === win.eventId);
              if (!plane) return null;
              return <WhiteboardWindow key={win.eventId} win={win} plane={plane} />;
            })}

          {/* minimized pages & boards: browser-tab strip centered at the bottom */}
          {graph &&
            (boards.some((b) => b.mode === "minimized") || minimizedPlanes.length > 0) && (
            <div className="pointer-events-auto absolute bottom-2 left-1/2 z-40 flex -translate-x-1/2 gap-1">
              {minimizedPlanes.map((id) => {
                const plane = graph.planes.find((p) => p.id === id);
                if (!plane) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-1.5 rounded-t-md border border-b-0 border-slate-300 bg-white px-2.5 py-1 shadow-sm"
                  >
                    <button
                      onClick={() => restorePlane(id)}
                      title={t("page.restore")}
                      className="max-w-40 truncate text-[10px] font-semibold text-slate-600 hover:text-[#1971C2]"
                    >
                      ▤ {plane.occurred_at?.slice(0, 10) ?? plane.title}
                    </button>
                    <button
                      onClick={() => void deletePageFromTab(id)}
                      title={t("page.delete")}
                      className="rounded-full px-1 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
              {boards
                .filter((b) => b.mode === "minimized")
                .map((b) => {
                  const plane = graph.planes.find((p) => p.id === b.eventId);
                  if (!plane) return null;
                  return (
                    <div
                      key={b.eventId}
                      className="flex items-center gap-1.5 rounded-t-md border border-b-0 border-slate-300 bg-white px-2.5 py-1 shadow-sm"
                    >
                      <button
                        onClick={() => setBoardMode(b.eventId, "normal")}
                        className="max-w-40 truncate text-[10px] font-semibold text-slate-600 hover:text-[#1971C2]"
                        title={plane.ai_subtitle ?? plane.title}
                      >
                        ▣ {plane.occurred_at?.slice(0, 10) ?? plane.title}
                      </button>
                      <button
                        onClick={() => closeBoard(b.eventId)}
                        className="rounded-full px-1 text-[10px] text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* ===== right inspector — burger drawer (closed by default) ===== */}
      {!inspectorOpen && (
        <button
          onClick={() => setInspectorOpen(true)}
          title={t("graph.inspector")}
          className="absolute right-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded border border-slate-300 bg-white text-base text-slate-600 shadow-sm hover:border-[#1971C2] hover:text-[#1971C2]"
        >
          ☰
        </button>
      )}
      {inspectorOpen && (
      <aside className="absolute inset-y-0 right-0 z-40 flex w-80 flex-col overflow-auto border-l border-border-dim bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-dim px-3 py-2">
          <span className="text-xs font-bold text-slate-700">{t("graph.inspector")}</span>
          <button
            onClick={() => setInspectorOpen(false)}
            className="rounded-full px-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-red-600"
          >
            ✕
          </button>
        </div>
        <h4 className="px-3 pt-3 text-xs font-semibold text-muted">
          {t("star.panelTitle")}
        </h4>
        {graph && <StarredPanel graph={graph} />}
        <div className="border-t border-border-dim" />
        {graph && selectedClaim ? (
          <>
            <h4 className="px-3 pt-3 text-xs font-semibold text-muted">
              {t("support.panelTitle")}
            </h4>
            <SupportPanel graph={graph} claimId={selectedClaim.id} aggregates={aggregates} />
          </>
        ) : graph && selectedPlane ? (
          /* selected time layer: date first, AI subtitle, board entry point */
          <div className="flex flex-col gap-2 p-3">
            <div className="text-base font-bold text-slate-800">
              {selectedPlane.occurred_at?.slice(0, 10) ?? "Date unknown"}
            </div>
            <p className="text-[11px] leading-snug text-muted">
              {selectedPlane.ai_subtitle ?? selectedPlane.title}
            </p>
            <p className="text-[10px] text-muted">
              {graph.claims.filter((c) => c.event_id === selectedPlane.id).length} claims
              on this layer
            </p>
            <button
              onClick={() => openBoard(selectedPlane.id)}
              className="rounded bg-[#1971C2] px-2 py-1.5 text-xs font-semibold text-white hover:bg-[#1257A0]"
            >
              ▣ {t("board.open")}
            </button>
          </div>
        ) : (
          <div className="p-4 text-[11px] leading-relaxed text-muted">
            Select a claim card to inspect its support metrics, or select a time
            layer to open its investigation board.
            <br />
            Double-click any object to focus it.
          </div>
        )}
        <div className="border-t border-border-dim">
          <h4 className="px-3 pt-3 text-xs font-semibold text-muted">{t("graph.linkTool")}</h4>
          {graph && <LinkCreator graph={graph} />}
        </div>
        <div className="border-t border-border-dim">
          <h4 className="px-3 pt-3 text-xs font-semibold text-muted">{t("graph.conflicts")}</h4>
          {graph && <ConflictPanel graph={graph} />}
        </div>
      </aside>
      )}
    </div>
  );
}
