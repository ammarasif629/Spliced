"use client";
// Phase 2 + 4 — Collaborative whiteboard per time layer, in a managed window.
// Tools: pen / marker / highlighter / eraser · sticky notes (move/resize/color/link)
// Evidence attachments (testimony/image/pdf/doc/url/video) · op history · undo/redo.
// Sync: polling (2.5s) against the op log — every action stores actor + timestamp.
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { useAppStore, type BoardWindow as WinState } from "@/lib/client/store";
import type { EventPlane, TestimonyRecord } from "@/lib/types";
import { t } from "@/lib/i18n/en";

type Tool = "select" | "pen" | "marker" | "highlighter" | "eraser" | "note" | "link";

interface BoardObject {
  id: string;
  kind: "note" | "stroke" | "attachment" | "note_link";
  data: Record<string, unknown>;
  x: number; y: number; w: number; h: number;
  color: string | null;
  created_by: string | null;
}

interface OpRow { seq: number; action: string; actor: string; at: string }

const TOOL_STYLE: Record<string, { stroke: string; width: number; opacity: number }> = {
  pen: { stroke: "#343A40", width: 2, opacity: 1 },
  marker: { stroke: "#1971C2", width: 4, opacity: 1 },
  highlighter: { stroke: "#FFD43B", width: 14, opacity: 0.45 },
};

const NOTE_COLORS = ["#FFF9B1", "#D0EBFF", "#D3F9D8", "#FFDEEB", "#FFE8CC"];

const BOARD_W = 1600;
const BOARD_H = 1100;

export function WhiteboardWindow({ win, plane }: { win: WinState; plane: EventPlane }) {
  const qc = useQueryClient();
  const { newsroomId, closeBoard, setBoardMode, bringToFront } = useAppStore();
  const [tool, setTool] = useState<Tool>("select");
  const [showHistory, setShowHistory] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const queryKey = ["board", newsroomId, win.eventId];
  const { data } = useQuery<{ objects: BoardObject[]; seq: number }>({
    queryKey,
    queryFn: () => api(`/api/boards/${win.eventId}`),
    enabled: !!newsroomId,
    refetchInterval: 2500, // real-time collaboration via op-log polling
  });
  const objects = data?.objects ?? [];

  const { data: ops } = useQuery<OpRow[]>({
    queryKey: ["board-ops", newsroomId, win.eventId],
    queryFn: () => api(`/api/boards/${win.eventId}/ops`),
    enabled: !!newsroomId && showHistory,
    refetchInterval: showHistory ? 2500 : false,
  });

  const { data: testimonies } = useQuery<TestimonyRecord[]>({
    queryKey: ["testimonies", newsroomId],
    queryFn: () => api("/api/testimonies"),
    enabled: !!newsroomId && attachOpen,
  });

  // ---------- mutations + undo/redo (operation history, Phase 2) ----------
  const undoStack = useRef<{ undo: () => Promise<unknown>; redo: () => Promise<unknown> }[]>([]);
  const undoPos = useRef(0);
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["board-ops", newsroomId, win.eventId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, newsroomId, win.eventId]);

  const createObj = useMutation({
    mutationFn: (input: Partial<BoardObject> & { kind: BoardObject["kind"] }) =>
      api<{ id: string }>(`/api/boards/${win.eventId}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: refresh,
  });
  const patchObj = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
      api(`/api/boards/object/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    onSuccess: refresh,
  });

  const pushUndo = (entry: { undo: () => Promise<unknown>; redo: () => Promise<unknown> }) => {
    undoStack.current = undoStack.current.slice(0, undoPos.current);
    undoStack.current.push(entry);
    undoPos.current = undoStack.current.length;
  };
  const doUndo = async () => {
    if (undoPos.current === 0) return;
    undoPos.current--;
    await undoStack.current[undoPos.current].undo();
    refresh();
  };
  const doRedo = async () => {
    if (undoPos.current >= undoStack.current.length) return;
    await undoStack.current[undoPos.current].redo();
    undoPos.current++;
    refresh();
  };

  // ---------- helpers ----------
  const createWithUndo = async (input: Partial<BoardObject> & { kind: BoardObject["kind"] }) => {
    const { id } = await createObj.mutateAsync(input);
    pushUndo({
      undo: () => patchObj.mutateAsync({ id, deleted: 1, action: "Undo" }),
      redo: () => patchObj.mutateAsync({ id, deleted: 0, action: "Redo" }),
    });
    return id;
  };
  const patchWithUndo = async (
    id: string,
    patch: Record<string, unknown>,
    before: Record<string, unknown>,
    action: string
  ) => {
    await patchObj.mutateAsync({ id, ...patch, action });
    pushUndo({
      undo: () => patchObj.mutateAsync({ id, ...before, action: "Undo" }),
      redo: () => patchObj.mutateAsync({ id, ...patch, action: "Redo" }),
    });
  };
  const deleteWithUndo = async (id: string) => {
    await patchObj.mutateAsync({ id, deleted: 1 });
    pushUndo({
      undo: () => patchObj.mutateAsync({ id, deleted: 0, action: "Undo" }),
      redo: () => patchObj.mutateAsync({ id, deleted: 1, action: "Redo" }),
    });
  };

  // ---------- drawing ----------
  const [draft, setDraft] = useState<{ points: [number, number][]; tool: string } | null>(null);
  const drawing = useRef(false);

  const boardPos = (e: React.PointerEvent): [number, number] => {
    const r = boardRef.current!.getBoundingClientRect();
    return [
      e.clientX - r.left + boardRef.current!.scrollLeft,
      e.clientY - r.top + boardRef.current!.scrollTop,
    ];
  };

  const onBoardPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (tool === "pen" || tool === "marker" || tool === "highlighter") {
      drawing.current = true;
      setDraft({ points: [boardPos(e)], tool });
    } else if (tool === "note") {
      const [x, y] = boardPos(e);
      void createWithUndo({
        kind: "note",
        x: x - 80, y: y - 60, w: 170, h: 120,
        color: NOTE_COLORS[objects.filter((o) => o.kind === "note").length % NOTE_COLORS.length],
        data: { text: "" },
      });
      setTool("select");
    }
  };
  const onBoardPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current || !draft) return;
    setDraft((d) => (d ? { ...d, points: [...d.points, boardPos(e)] } : d));
  };
  const onBoardPointerUp = () => {
    if (drawing.current && draft && draft.points.length > 1) {
      const xs = draft.points.map((p) => p[0]);
      const ys = draft.points.map((p) => p[1]);
      void createWithUndo({
        kind: "stroke",
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
        data: { points: draft.points, tool: draft.tool },
      });
    }
    drawing.current = false;
    setDraft(null);
  };

  // ---------- window chrome ----------
  const headerDrag = useRef<{ dx: number; dy: number } | null>(null);
  const onHeaderDown = (e: React.PointerEvent) => {
    if (win.mode === "fullscreen") return;
    bringToFront(win.eventId);
    headerDrag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHeaderMove = (e: React.PointerEvent) => {
    if (!headerDrag.current) return;
    useAppStore.setState((s) => ({
      boards: s.boards.map((b) =>
        b.eventId === win.eventId
          ? { ...b, x: Math.max(0, e.clientX - headerDrag.current!.dx), y: Math.max(0, e.clientY - headerDrag.current!.dy) }
          : b
      ),
    }));
  };
  const onHeaderUp = () => (headerDrag.current = null);

  // minimized windows are rendered as tabs in the bottom strip (see graph page)
  if (win.mode === "minimized") return null;

  const frame =
    win.mode === "fullscreen" ? "absolute inset-2" : "absolute w-[640px] h-[480px]";

  const noteObjects = objects.filter((o) => o.kind === "note");
  const centerOf = (o: BoardObject): [number, number] => [o.x + o.w / 2, o.y + o.h / 2];

  return (
    <div
      className={`${frame} pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl`}
      style={
        win.mode === "fullscreen" ? { zIndex: win.z } : { left: win.x, top: win.y, zIndex: win.z }
      }
      onPointerDown={() => bringToFront(win.eventId)}
    >
      {/* ===== window header (Phase 4) ===== */}
      <div
        className="flex h-9 shrink-0 cursor-move items-center gap-2 border-b border-border-dim bg-[#F8F9FA] px-3"
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={onHeaderUp}
      >
        {/* date is the primary label; AI day summary as subtitle */}
        <span className="text-xs font-bold text-slate-800">
          ▣ {plane.occurred_at?.slice(0, 10) ?? "Date unknown"}
        </span>
        <span className="truncate text-[10px] text-muted">
          {plane.ai_subtitle ?? plane.title} — {t("board.title")}
        </span>
        {/* browser-tab style controls: minimize · fullscreen/restore · close */}
        <div className="ml-auto flex items-center gap-0.5">
          <HeaderBtn
            label={t("board.minimize")}
            onClick={() => setBoardMode(win.eventId, "minimized")}
          >
            —
          </HeaderBtn>
          <HeaderBtn
            label={win.mode === "fullscreen" ? t("board.restore") : t("board.fullscreen")}
            onClick={() =>
              setBoardMode(win.eventId, win.mode === "fullscreen" ? "normal" : "fullscreen")
            }
          >
            {win.mode === "fullscreen" ? "❐" : "□"}
          </HeaderBtn>
          <HeaderBtn label={t("board.close")} onClick={() => closeBoard(win.eventId)}>
            ✕
          </HeaderBtn>
        </div>
      </div>

      {(
        <>
          {/* ===== toolbar ===== */}
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-dim bg-white px-2 py-1">
            {(
              [
                ["select", "⬚", t("board.select")],
                ["pen", "✎", t("board.pen")],
                ["marker", "🖊", t("board.marker")],
                ["highlighter", "🖍", t("board.highlighter")],
                ["eraser", "⌫", t("board.eraser")],
                ["note", "🗒", t("board.note")],
                ["link", "🔗", t("board.link")],
              ] as [Tool, string, string][]
            ).map(([tl, icon, label]) => (
              <button
                key={tl}
                title={label}
                onClick={() => { setTool(tl); setLinkFrom(null); }}
                className={`rounded px-2 py-0.5 text-xs ${
                  tool === tl ? "bg-[#1971C2] text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {icon} {label}
              </button>
            ))}
            <button
              title={t("board.attach")}
              onClick={() => setAttachOpen((o) => !o)}
              className={`rounded px-2 py-0.5 text-xs ${attachOpen ? "bg-[#1971C2] text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              📎 {t("board.attach")}
            </button>
            <div className="mx-1 h-4 w-px bg-slate-200" />
            <button onClick={doUndo} className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
              ↩ {t("board.undo")}
            </button>
            <button onClick={doRedo} className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
              ↪ {t("board.redo")}
            </button>
            <button
              onClick={() => setShowHistory((h) => !h)}
              className={`ml-auto rounded px-2 py-0.5 text-xs ${showHistory ? "bg-slate-200 text-slate-700" : "text-slate-600 hover:bg-slate-100"}`}
            >
              🕘 {t("board.history")}
            </button>
          </div>

          {attachOpen && (
            <AttachForm
              testimonies={testimonies ?? []}
              onAttach={(payload) => {
                void createWithUndo({
                  kind: "attachment",
                  x: 40 + Math.random() * 80, y: 40 + Math.random() * 60,
                  w: 220, h: 90,
                  data: payload,
                });
                setAttachOpen(false);
              }}
            />
          )}

          {/* ===== board surface + optional history drawer ===== */}
          <div className="flex min-h-0 flex-1">
            <div
              ref={boardRef}
              className="relative min-w-0 flex-1 overflow-auto bg-[#F8F9FA]"
              style={{
                cursor:
                  tool === "select" ? "default" : tool === "eraser" ? "not-allowed" : "crosshair",
              }}
              onPointerDown={onBoardPointerDown}
              onPointerMove={onBoardPointerMove}
              onPointerUp={onBoardPointerUp}
            >
              <div className="relative" style={{ width: BOARD_W, height: BOARD_H }}>
                {/* dot grid */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: "radial-gradient(#DEE2E6 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                />
                {/* note links */}
                <svg className="pointer-events-none absolute inset-0" width={BOARD_W} height={BOARD_H}>
                  {objects
                    .filter((o) => o.kind === "note_link")
                    .map((o) => {
                      const a = noteObjects.find((n) => n.id === o.data.from);
                      const b = noteObjects.find((n) => n.id === o.data.to);
                      if (!a || !b) return null;
                      const [x1, y1] = centerOf(a);
                      const [x2, y2] = centerOf(b);
                      return (
                        <line key={o.id} x1={x1} y1={y1} x2={x2} y2={y2}
                          stroke="#868E96" strokeWidth={1.5} strokeDasharray="5 4" />
                      );
                    })}
                </svg>
                {/* strokes */}
                <svg
                  className="absolute inset-0"
                  width={BOARD_W}
                  height={BOARD_H}
                  style={{ pointerEvents: tool === "eraser" ? "auto" : "none" }}
                >
                  {objects
                    .filter((o) => o.kind === "stroke")
                    .map((o) => {
                      const pts = (o.data.points as [number, number][]) ?? [];
                      const st = TOOL_STYLE[(o.data.tool as string) ?? "pen"] ?? TOOL_STYLE.pen;
                      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
                      return (
                        <g key={o.id}>
                          <path d={d} fill="none" stroke={st.stroke} strokeWidth={st.width}
                            strokeOpacity={st.opacity} strokeLinecap="round" strokeLinejoin="round" />
                          {tool === "eraser" && (
                            <path d={d} fill="none" stroke="transparent" strokeWidth={16}
                              style={{ cursor: "not-allowed" }}
                              onPointerDown={(e) => { e.stopPropagation(); void deleteWithUndo(o.id); }} />
                          )}
                        </g>
                      );
                    })}
                  {draft && (
                    <path
                      d={draft.points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ")}
                      fill="none"
                      stroke={TOOL_STYLE[draft.tool].stroke}
                      strokeWidth={TOOL_STYLE[draft.tool].width}
                      strokeOpacity={TOOL_STYLE[draft.tool].opacity}
                      strokeLinecap="round" strokeLinejoin="round"
                    />
                  )}
                </svg>

                {/* notes & attachments */}
                {objects
                  .filter((o) => o.kind === "note" || o.kind === "attachment")
                  .map((o) => (
                    <BoardItem
                      key={o.id}
                      obj={o}
                      tool={tool}
                      linkFrom={linkFrom}
                      onLinkClick={(id) => {
                        if (tool !== "link") return;
                        if (!linkFrom) setLinkFrom(id);
                        else if (linkFrom !== id) {
                          void createWithUndo({
                            kind: "note_link",
                            data: { from: linkFrom, to: id },
                            x: 0, y: 0, w: 0, h: 0,
                          });
                          setLinkFrom(null);
                          setTool("select");
                        }
                      }}
                      onMove={(x, y, before) =>
                        void patchWithUndo(o.id, { x, y }, before, `Moved ${o.kind === "note" ? "Note" : "Evidence"}`)
                      }
                      onResize={(w, h, before) =>
                        void patchWithUndo(o.id, { w, h }, before, "Resized Note")
                      }
                      onRecolor={(color) =>
                        void patchWithUndo(o.id, { color }, { color: o.color }, "Recolored Note")
                      }
                      onText={(text) =>
                        void patchWithUndo(o.id, { data: { ...o.data, text } }, { data: o.data }, "Edited Note")
                      }
                      onDelete={() => void deleteWithUndo(o.id)}
                    />
                  ))}

                {objects.length === 0 && !draft && (
                  <div className="absolute left-1/2 top-24 -translate-x-1/2 text-xs text-muted">
                    {t("board.empty")}
                  </div>
                )}
              </div>
            </div>

            {showHistory && (
              <div className="w-56 shrink-0 overflow-auto border-l border-border-dim bg-white p-2">
                <h5 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t("board.history")}
                </h5>
                {(ops ?? []).map((op) => (
                  <div key={op.seq} className="mb-1.5 border-b border-slate-100 pb-1 text-[10px] leading-tight">
                    <div className="font-semibold text-slate-700">{op.actor}</div>
                    <div className="text-slate-500">{op.action}</div>
                    <div className="text-slate-400">{op.at} UTC</div>
                  </div>
                ))}
                {(ops ?? []).length === 0 && (
                  <p className="text-[10px] italic text-muted">No operations yet.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HeaderBtn({
  label, onClick, children,
}: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-800"
    >
      {children}
    </button>
  );
}

// ---------- draggable / resizable board item ----------
function BoardItem({
  obj, tool, linkFrom, onLinkClick, onMove, onResize, onRecolor, onText, onDelete,
}: {
  obj: BoardObject;
  tool: Tool;
  linkFrom: string | null;
  onLinkClick: (id: string) => void;
  onMove: (x: number, y: number, before: { x: number; y: number }) => void;
  onResize: (w: number, h: number, before: { w: number; h: number }) => void;
  onRecolor: (color: string) => void;
  onText: (text: string) => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState({ x: obj.x, y: obj.y, w: obj.w, h: obj.h });
  const [selected, setSelected] = useState(false);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  useEffect(() => setLocal({ x: obj.x, y: obj.y, w: obj.w, h: obj.h }), [obj.x, obj.y, obj.w, obj.h]);

  const startDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSelected(true);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, ox: local.x, oy: local.y, ow: local.w, oh: local.h };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === "move")
      setLocal((l) => ({ ...l, x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy) }));
    else
      setLocal((l) => ({ ...l, w: Math.max(90, d.ow + dx), h: Math.max(60, d.oh + dy) }));
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.mode === "move" && (local.x !== d.ox || local.y !== d.oy))
      onMove(local.x, local.y, { x: d.ox, y: d.oy });
    if (d.mode === "resize" && (local.w !== d.ow || local.h !== d.oh))
      onResize(local.w, local.h, { w: d.ow, h: d.oh });
  };

  const isNote = obj.kind === "note";
  const att = obj.data as { type?: string; url?: string; title?: string };

  return (
    <div
      className={`absolute rounded-md border shadow-sm ${
        linkFrom === obj.id
          ? "border-[#1971C2] ring-2 ring-[#1971C2]/40"
          : selected && tool === "select"
          ? "border-[#1971C2]"
          : "border-slate-300"
      }`}
      style={{
        left: local.x, top: local.y, width: local.w, height: local.h,
        background: isNote ? obj.color ?? "#FFF9B1" : "#FFFFFF",
        cursor: tool === "select" ? "grab" : tool === "link" ? "alias" : "inherit",
      }}
      onPointerDown={(e) => {
        if (tool === "link") { e.stopPropagation(); onLinkClick(obj.id); return; }
        startDrag(e, "move");
      }}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
    >
      {isNote ? (
        <textarea
          defaultValue={(obj.data.text as string) ?? ""}
          placeholder="Type…"
          onPointerDown={(e) => { if (tool !== "select") return; e.stopPropagation(); }}
          onBlur={(e) => {
            if (e.target.value !== ((obj.data.text as string) ?? "")) onText(e.target.value);
          }}
          className="h-full w-full resize-none bg-transparent p-2 text-[11px] leading-snug text-slate-800 outline-none"
        />
      ) : (
        <div className="flex h-full flex-col p-2 text-[11px]">
          <div className="font-semibold text-slate-700">
            {att.type === "testimony" ? "❝" : att.type === "image" ? "🖼" : att.type === "video" ? "🎞" : att.type === "pdf" ? "📕" : "📄"}{" "}
            {att.title ?? att.type}
          </div>
          {att.type === "image" && att.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={att.url} alt={att.title ?? "attachment"} className="mt-1 min-h-0 flex-1 rounded object-cover" />
          ) : att.url ? (
            <a href={att.url} target="_blank" rel="noreferrer"
              className="mt-1 truncate text-[10px] text-[#1971C2] underline"
              onPointerDown={(e) => e.stopPropagation()}>
              {att.url}
            </a>
          ) : null}
        </div>
      )}

      {selected && tool === "select" && (
        <>
          {isNote && (
            <div className="absolute -top-6 left-0 flex gap-1 rounded bg-white px-1 py-0.5 shadow"
              onPointerDown={(e) => e.stopPropagation()}>
              {NOTE_COLORS.map((c) => (
                <button key={c} onClick={() => onRecolor(c)}
                  className="h-3.5 w-3.5 rounded-full border border-slate-300"
                  style={{ background: c }} />
              ))}
            </div>
          )}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDelete}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[10px] text-white shadow"
          >
            ✕
          </button>
          <div
            onPointerDown={(e) => startDrag(e, "resize")}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            className="absolute -bottom-1 -right-1 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-slate-400 bg-white"
          />
        </>
      )}
    </div>
  );
}

// ---------- evidence attach form ----------
function AttachForm({
  testimonies,
  onAttach,
}: {
  testimonies: TestimonyRecord[];
  onAttach: (payload: Record<string, unknown>) => void;
}) {
  const [type, setType] = useState("testimony");
  const [url, setUrl] = useState("");
  const [testimonyId, setTestimonyId] = useState("");
  const sel = "rounded border border-border-dim bg-white px-2 py-1 text-[11px]";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-dim bg-blue-50/60 px-2 py-1.5">
      <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
        {["testimony", "image", "pdf", "document", "url", "video"].map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      {type === "testimony" ? (
        <select className={`${sel} max-w-64`} value={testimonyId} onChange={(e) => setTestimonyId(e.target.value)}>
          <option value="">Select testimony…</option>
          {testimonies.map((tm) => (
            <option key={tm.id} value={tm.id}>{tm.ai_title ?? tm.raw_text.slice(0, 40)}</option>
          ))}
        </select>
      ) : (
        <input className={`${sel} w-64`} placeholder="https://…" value={url}
          onChange={(e) => setUrl(e.target.value)} />
      )}
      <button
        disabled={type === "testimony" ? !testimonyId : !url}
        onClick={() => {
          const tm = testimonies.find((x) => x.id === testimonyId);
          onAttach(
            type === "testimony"
              ? { type, testimony_id: testimonyId, title: tm?.ai_title ?? "Testimony", url: `/testimonies/${testimonyId}` }
              : { type, url, title: url.split("/").pop() || type }
          );
        }}
        className="rounded bg-[#1971C2] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#1257A0] disabled:opacity-40"
      >
        Add to board
      </button>
    </div>
  );
}
