"use client";
import { create } from "zustand";

// Server state → TanStack Query. This store owns viewport/selection/window state.

export interface BoardWindow {
  eventId: string;
  // browser-tab-like window states: minimize shrinks it into the bottom tab strip
  mode: "normal" | "minimized" | "fullscreen";
  x: number;
  y: number;
  z: number; // stacking order
}

// Star groups — pin "hot" billboards/boards into named groups (persisted locally)
export interface StarGroup {
  id: string;
  name: string;
  items: string[]; // claim ids or plane(event) ids
}

function loadStarGroups(): StarGroup[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("veritas.stars") ?? "[]");
  } catch {
    return [];
  }
}

function persistStars(groups: StarGroup[]) {
  if (typeof window !== "undefined")
    localStorage.setItem("veritas.stars", JSON.stringify(groups));
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function persistJson(key: string, value: unknown) {
  if (typeof window !== "undefined") localStorage.setItem(key, JSON.stringify(value));
}

interface AppState {
  newsroomId: string | null;
  setNewsroom: (id: string) => void;

  nickname: string;
  setNickname: (n: string) => void;

  // Phase 7: 2D/3D toggle — scene is never reloaded, only the camera changes
  viewMode: "2d" | "3d";
  setViewMode: (m: "2d" | "3d") => void;

  // Phase 5: selection (claims / planes / any object id)
  selection: string[];
  setSelection: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;

  // Phase 5: focus/frame request consumed by the viewport controller
  focusRequest: { point: [number, number, number]; ts: number } | null;
  requestFocus: (point: [number, number, number]) => void;

  // Reset Position — return the camera to the home view
  resetRequest: number;
  requestReset: () => void;

  // Stars: multiple billboards/boards, organizable into custom-named groups
  starGroups: StarGroup[];
  toggleStar: (itemId: string) => void;
  createStarGroup: (name: string) => void;
  renameStarGroup: (groupId: string, name: string) => void;
  deleteStarGroup: (groupId: string) => void;
  moveStar: (itemId: string, groupId: string) => void;

  // distance between pages along the timeline (top-of-screen slider, persisted)
  pageGap: number;
  setPageGap: (g: number) => void;

  // Free placement of claim cards: each card carries its own grip handle, so there
  // is no global mode — dragging a handle writes straight through to cardPositions.
  // per-claim [x, y] override on its plane (persisted locally)
  cardPositions: Record<string, [number, number]>;
  setCardPosition: (claimId: string, xy: [number, number]) => void;

  // page (time-layer) window states: minimize collapses in place, delete hides
  minimizedPlanes: string[];
  minimizePlane: (id: string) => void;
  restorePlane: (id: string) => void;
  hiddenPlanes: string[];
  hidePlane: (id: string) => void;
  unhidePlane: (id: string) => void;
  // maximized page: head-on focus view with prev/next navigation
  maximizedPlane: string | null;
  setMaximizedPlane: (id: string | null) => void;

  // bumped after destructive mutations fired from inside the WebGL canvas
  // (no React context there) — the graph page invalidates queries on change
  graphVersion: number;
  bumpGraph: () => void;

  // Phase 4: whiteboard windows (multiple visible simultaneously)
  boards: BoardWindow[];
  openBoard: (eventId: string) => void;
  closeBoard: (eventId: string) => void;
  setBoardMode: (eventId: string, mode: BoardWindow["mode"]) => void;
  bringToFront: (eventId: string) => void;
}

let zCounter = 10;

const initialNickname =
  typeof window !== "undefined"
    ? localStorage.getItem("veritas.nickname") ??
      `Analyst_${Math.floor(Math.random() * 900 + 100)}`
    : "Analyst";

export const useAppStore = create<AppState>((set) => ({
  newsroomId:
    typeof window !== "undefined" ? localStorage.getItem("veritas.newsroom") : null,
  setNewsroom: (id) => {
    if (typeof window !== "undefined") localStorage.setItem("veritas.newsroom", id);
    set({ newsroomId: id, selection: [], boards: [] });
  },

  nickname: initialNickname,
  setNickname: (n) => {
    if (typeof window !== "undefined") localStorage.setItem("veritas.nickname", n);
    set({ nickname: n });
  },

  viewMode: "3d",
  setViewMode: (m) => set({ viewMode: m }),

  selection: [],
  setSelection: (ids) => set({ selection: ids }),
  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),
  clearSelection: () => set({ selection: [] }),

  focusRequest: null,
  requestFocus: (point) => set({ focusRequest: { point, ts: Date.now() } }),

  resetRequest: 0,
  requestReset: () => set({ resetRequest: Date.now() }),

  starGroups: loadStarGroups(),
  toggleStar: (itemId) =>
    set((s) => {
      const starred = s.starGroups.some((g) => g.items.includes(itemId));
      let groups: StarGroup[];
      if (starred) {
        groups = s.starGroups.map((g) => ({
          ...g,
          items: g.items.filter((i) => i !== itemId),
        }));
      } else {
        groups = s.starGroups.length
          ? s.starGroups.map((g, i) =>
              i === 0 ? { ...g, items: [...g.items, itemId] } : g
            )
          : [{ id: crypto.randomUUID(), name: "Starred", items: [itemId] }];
      }
      persistStars(groups);
      return { starGroups: groups };
    }),
  createStarGroup: (name) =>
    set((s) => {
      const groups = [...s.starGroups, { id: crypto.randomUUID(), name, items: [] }];
      persistStars(groups);
      return { starGroups: groups };
    }),
  renameStarGroup: (groupId, name) =>
    set((s) => {
      const groups = s.starGroups.map((g) => (g.id === groupId ? { ...g, name } : g));
      persistStars(groups);
      return { starGroups: groups };
    }),
  deleteStarGroup: (groupId) =>
    set((s) => {
      const groups = s.starGroups.filter((g) => g.id !== groupId);
      persistStars(groups);
      return { starGroups: groups };
    }),
  moveStar: (itemId, groupId) =>
    set((s) => {
      const groups = s.starGroups.map((g) => ({
        ...g,
        items:
          g.id === groupId
            ? [...g.items.filter((i) => i !== itemId), itemId]
            : g.items.filter((i) => i !== itemId),
      }));
      persistStars(groups);
      return { starGroups: groups };
    }),

  pageGap: loadJson("veritas.pagegap", 8),
  setPageGap: (g) => {
    persistJson("veritas.pagegap", g);
    set({ pageGap: g });
  },

  cardPositions: loadJson("veritas.cardpos", {}),
  setCardPosition: (claimId, xy) =>
    set((s) => {
      // re-insert at the end: key order encodes drag recency (last dragged on top)
      const { [claimId]: _prev, ...rest } = s.cardPositions;
      void _prev;
      const cardPositions = { ...rest, [claimId]: xy };
      persistJson("veritas.cardpos", cardPositions);
      return { cardPositions };
    }),

  minimizedPlanes: loadJson("veritas.minplanes", []),
  minimizePlane: (id) =>
    set((s) => {
      const minimizedPlanes = [...new Set([...s.minimizedPlanes, id])];
      persistJson("veritas.minplanes", minimizedPlanes);
      return { minimizedPlanes, maximizedPlane: s.maximizedPlane === id ? null : s.maximizedPlane };
    }),
  restorePlane: (id) =>
    set((s) => {
      const minimizedPlanes = s.minimizedPlanes.filter((x) => x !== id);
      persistJson("veritas.minplanes", minimizedPlanes);
      return { minimizedPlanes };
    }),
  hiddenPlanes: loadJson("veritas.hiddenplanes", []),
  hidePlane: (id) =>
    set((s) => {
      const hiddenPlanes = [...new Set([...s.hiddenPlanes, id])];
      const minimizedPlanes = s.minimizedPlanes.filter((x) => x !== id);
      persistJson("veritas.hiddenplanes", hiddenPlanes);
      persistJson("veritas.minplanes", minimizedPlanes);
      return {
        hiddenPlanes,
        minimizedPlanes,
        selection: s.selection.filter((x) => x !== id),
        boards: s.boards.filter((b) => b.eventId !== id),
        maximizedPlane: s.maximizedPlane === id ? null : s.maximizedPlane,
      };
    }),
  unhidePlane: (id) =>
    set((s) => {
      const hiddenPlanes = s.hiddenPlanes.filter((x) => x !== id);
      persistJson("veritas.hiddenplanes", hiddenPlanes);
      return { hiddenPlanes };
    }),
  maximizedPlane: null,
  setMaximizedPlane: (id) => set({ maximizedPlane: id }),

  graphVersion: 0,
  bumpGraph: () => set((s) => ({ graphVersion: s.graphVersion + 1 })),

  boards: [],
  openBoard: (eventId) =>
    set((s) =>
      s.boards.some((b) => b.eventId === eventId)
        ? { boards: s.boards.map((b) => (b.eventId === eventId ? { ...b, z: ++zCounter } : b)) }
        : {
            boards: [
              ...s.boards,
              { eventId, mode: "normal", x: 60 + s.boards.length * 36, y: 60 + s.boards.length * 28, z: ++zCounter },
            ],
          }
    ),
  closeBoard: (eventId) =>
    set((s) => ({ boards: s.boards.filter((b) => b.eventId !== eventId) })),
  setBoardMode: (eventId, mode) =>
    set((s) => ({
      boards: s.boards.map((b) => (b.eventId === eventId ? { ...b, mode, z: ++zCounter } : b)),
    })),
  bringToFront: (eventId) =>
    set((s) => ({
      boards: s.boards.map((b) => (b.eventId === eventId ? { ...b, z: ++zCounter } : b)),
    })),
}));

// debug/testing hook — lets headless verification drive the store
if (typeof window !== "undefined") {
  (window as unknown as { __appStore: typeof useAppStore }).__appStore = useAppStore;
}
