"use client";
// Professional investigative viewport (Blender/Unity-inspired).
// - WASD/QE fly camera, Shift accelerate, RMB rotate, MMB pan, wheel dolly (damped)
// - LMB drag = box select, click = select, ctrl+click = multi select
// - Double-click = focus object, F = frame selection, Reset Position = home view
// - 2D (top-down) / 3D toggle: camera-only transition, scene never reloads. In 2D the
//   pages tilt back toward the overhead camera (TILT_2D) so they read as pages, not
//   as thin edge-on lines; cards are billboards and always face the camera.
// - Cards are WebGL meshes + canvas-rasterized text; they render in the transparent
//   pass with a raised renderOrder so acrylic planes never tint/shadow them, while
//   depth testing keeps overlapping cards correctly occluded.
// - Direct evidence is NOT drawn as green lines: it lives inside each card behind
//   a "See more" stair-style expand/collapse.
// - Star (★) pins billboards/boards into the sidebar groups.
// - Each card carries its own grip handle (top-left dots): drag it to reposition the
//   card on its page. There is no global "transform" mode.
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Billboard, Line } from "@react-three/drei";
// NOTE: drei/troika <Text> is banned here — its SDF glyph shader hangs the GPU on
// current Edge/Chromium ANGLE and the browser kills the WebGL context ("Context
// Lost", frozen viewport). CanvasText rasterizes labels with canvas 2D instead.
import { CanvasText as Text } from "@/components/graph/CanvasText";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { EvidenceRecord, GraphPayload, LinkKind } from "@/lib/types";
import { LINK_COLORS } from "@/lib/types";
import { useAppStore } from "@/lib/client/store";
import { api } from "@/lib/client/api";
import { conflictByClaim, conflictLinkIds, conflictPairs } from "@/lib/client/conflicts";
import { t } from "@/lib/i18n/en";

const Z_GAP = 8;
const PLANE_W = 12;
const PLANE_H = 7;
export const HOME_POSITION: [number, number, number] = [17, 9, 22];

// 2D view: pages recline toward the top-down camera. Not a full 90° — that would
// make each page's depth footprint exactly PLANE_H and let neighbours touch; 88%
// of a right angle keeps a sliver of separation while staying ~98% legible.
export const TILT_2D = (-Math.PI / 2) * 0.88;

// ---------- aggregates for layered disclosure ----------
export interface ClaimAggregate {
  supports: number;
  contradicts: number;
  evidence: number;
  agreement: number; // %
  confidence: "High" | "Medium" | "Low";
}

export function computeAggregates(graph: GraphPayload): Record<string, ClaimAggregate> {
  const agg: Record<string, ClaimAggregate> = {};
  const active = new Set(
    graph.claims
      .filter((c) => c.status === "active" && c.testimony_status === "active")
      .map((c) => c.id)
  );
  for (const c of graph.claims)
    agg[c.id] = { supports: 0, contradicts: 0, evidence: 0, agreement: 0, confidence: "Low" };
  for (const l of graph.links) {
    if (l.kind === "supports" && l.to_claim && active.has(l.from_claim))
      agg[l.to_claim] && agg[l.to_claim].supports++;
    if (l.kind === "contradicts" && l.to_claim) {
      if (active.has(l.from_claim)) agg[l.to_claim] && agg[l.to_claim].contradicts++;
      if (active.has(l.to_claim)) agg[l.from_claim] && agg[l.from_claim].contradicts++;
    }
    if (l.kind === "direct_evidence" && l.evidence_id)
      agg[l.from_claim] && agg[l.from_claim].evidence++;
  }
  for (const id of Object.keys(agg)) {
    const a = agg[id];
    const votes = a.supports + a.contradicts;
    a.agreement = votes === 0 ? (a.evidence > 0 ? 100 : 0) : Math.round((a.supports / votes) * 100);
    a.confidence =
      a.evidence > 0 || a.supports >= 2 ? "High" : a.supports === 1 ? "Medium" : "Low";
  }
  return agg;
}

// ---------- layout (exported so the sidebar can focus starred items) ----------
// Card drag bounds — cards stay inside the page (plane) rectangle
const CARD_W = 4.6;
const CARD_H = 2.1;
const CARD_X_MAX = PLANE_W / 2 - CARD_W / 2;
const CARD_Y_MAX = PLANE_H / 2 - CARD_H / 2;

// Pages sit on a straight line along Z; the gap between pages is adjustable
// via the "Page spacing" slider at the top of the viewport (persisted).
// "Lift" mechanic: a selected page rises clearly ABOVE the row (so it can be
// inspected without neighbours overlapping); a maximized page glides forward
// toward the camera. Both are driven by FocusRig in lockstep with the camera.
export const LIFT_SELECT_Y = 9;
export const LIFT_MAX = 5;

export interface PageLift {
  y: number; // upward lift (selection)
  f: number; // forward lift toward the camera (maximized)
}

export interface PlanePose {
  position: [number, number, number]; // lifted (live) pose
  basePosition: [number, number, number]; // resting slot on the timeline
  rotY: number; // kept for pose-generic consumers (always 0 in the straight layout)
  tilt: number; // X rotation — 0 in 3D, TILT_2D when reclined for the overhead camera
}

// Orthonormal basis of a page: u = local +X, v = local +Y, n = local +Z (its normal).
// Everything that maps plane-local coords to the world (card placement, drag
// ray-casting, the time axis offset) goes through this so the page can tilt freely.
export function poseBasis(tilt: number, rotY: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, rotY, 0));
  return {
    u: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
    v: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
    n: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
  };
}

export interface LayoutOptions {
  cardPositions?: Record<string, [number, number]>; // per-card placement overrides
  minimized?: string[]; // docked to the bottom tab strip: removed from the world
  hidden?: string[]; // deleted pages: removed from the world entirely
  gap?: number; // distance between adjacent pages (slider)
  lifts?: Record<string, PageLift>; // animated lift per page
  tilt?: number; // animated recline of every page (2D view)
}

export function computeLayout(graph: GraphPayload, opts?: LayoutOptions) {
  const hidden = new Set(opts?.hidden ?? []);
  // minimized pages KEEP their slot (no re-compaction) so restoring one returns
  // it to the exact position it occupied before — only its content is skipped
  const minimized = new Set(opts?.minimized ?? []);
  const hasOrphan = graph.claims.some((c) => !c.event_id);
  const planes = [
    ...graph.planes,
    ...(hasOrphan
      ? [{ id: "__orphan__", title: "Unassigned", occurred_at: null, occurred_precision: null }]
      : []),
  ].filter((p) => !hidden.has(p.id));
  const gap = opts?.gap ?? Z_GAP;
  const tilt = opts?.tilt ?? 0;
  const { u, v, n } = poseBasis(tilt, 0);
  const positions: Record<string, [number, number, number]> = {};
  const locals: Record<string, [number, number]> = {};
  const poses: Record<string, PlanePose> = {};
  // moved cards get a tiny z stagger by drag recency (insertion order) so
  // overlapping cards on the SAME page stack deterministically — the most
  // recently dragged card sits on top, like objects in Google Slides
  const movedOrder = Object.keys(opts?.cardPositions ?? {});
  planes.forEach((p, pi) => {
    const d = pi - (planes.length - 1) / 2;
    const lift = opts?.lifts?.[p.id];
    const basePosition: [number, number, number] = [0, 0, d * gap];
    const position: [number, number, number] = [
      0,
      lift?.y ?? 0,
      basePosition[2] + (lift?.f ?? 0),
    ];
    poses[p.id] = { position, basePosition, rotY: 0, tilt };
    if (minimized.has(p.id)) return; // docked page: slot kept, content hidden
    const claims = graph.claims.filter((c) => (c.event_id ?? "__orphan__") === p.id);
    claims.forEach((c, j) => {
      const moved = opts?.cardPositions?.[c.id];
      const lx = moved ? moved[0] : -2.9 + (j % 2) * 5.8;
      const ly = moved ? moved[1] : 1.8 - Math.floor(j / 2) * 2.6;
      const lz = moved ? 0.05 + movedOrder.indexOf(c.id) * 0.02 : j * 0.005;
      locals[c.id] = [lx, ly];
      // plane-local → world through the page's pose (rides the lift AND the tilt)
      positions[c.id] = [
        position[0] + u.x * lx + v.x * ly + n.x * lz,
        position[1] + u.y * lx + v.y * ly + n.y * lz,
        position[2] + u.z * lx + v.z * ly + n.z * lz,
      ];
    });
  });
  return { planes, positions, locals, poses };
}

// ---------- camera rig: input + focus flights + page animation ----------
// One component owns the camera outright, which is the whole point of this design.
// The old code eased the page lift with a damped spring while a *separate* camera
// flight aimed at the lift's final resting point on its own clock. The two curves
// disagreed every frame — that is what made selecting a page feel rough. Here a
// "flight" advances a single ease-in-out ramp `p` and drives BOTH the camera and
// the lifts from it, so the page stays perfectly framed for the whole move and
// simply glides into place. Any manual input revokes the rig's camera ownership
// mid-flight; the pages keep easing on their own.
interface Flight {
  running: boolean;
  owns: boolean; // rig still drives the camera (manual input revokes ownership)
  moveCamera: boolean; // false when only the lifts animate (e.g. deselect)
  u: number; // raw 0..1 progress
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  liftFrom: Record<string, PageLift>;
  liftTo: Record<string, PageLift>;
}

const FOCUS_DUR = 0.9; // seconds
const SELECT_DIST = 20; // head-on distance to a selected (lifted) page in 3D
const SELECT_ELEV = 3; // camera sits slightly above the page centre in 3D
const HOME_PAGES_2D = 3; // the 2D reset point frames this many pages
const SIN_2D = Math.abs(Math.sin(TILT_2D)); // how much of a page's height lies along Z once reclined
// A page plus its chrome spans local y ∈ [-PLANE_H/2, PLANE_H/2 + 1.29] (the window
// controls' top edge). Frame that box, not just the plane.
const PAGE_TOP = PLANE_H / 2 + 1.29;
const PAGE_AIM_Y = (PAGE_TOP - PLANE_H / 2) / 2;
const PAGE_HALF_H = (PAGE_TOP + PLANE_H / 2) / 2;

const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

const topDownQuat = () =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, "YXZ"));

const isPerspective = (c: THREE.Camera): c is THREE.PerspectiveCamera =>
  (c as THREE.PerspectiveCamera).isPerspectiveCamera === true;

// Viewport shortcuts must never steal a keystroke from a field the user is typing
// in — that includes IME composition (Korean/Japanese), where Enter commits text.
function isTyping(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return true;
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

// Distance at which a halfW × halfH rectangle just fits the frustum, both axes.
// `pad` > 1 leaves a sliver of breathing room around it.
function fitDistance(halfW: number, halfH: number, camera: THREE.Camera, pad = 1.05) {
  if (!isPerspective(camera)) return 20;
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return Math.max(halfH / tanHalf, halfW / (tanHalf * camera.aspect)) * pad;
}

// ---- reset points ----
// 3D: the fixed home vantage. 2D: framed on the first HOME_PAGES_2D pages, filling
// the viewport. The 2D point depends on page spacing and the window's aspect, so it
// is derived on demand rather than stored — "the saved reset position" is this rule.
function home3D(): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const pos = new THREE.Vector3(...HOME_POSITION);
  const m = new THREE.Matrix4().lookAt(pos, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
  return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
}

function home2D(
  order: string[],
  base: Record<string, [number, number, number]>,
  camera: THREE.Camera
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const zs = order
    .slice(0, HOME_PAGES_2D)
    .map((id) => base[id]?.[2])
    .filter((z): z is number => z !== undefined);
  if (!zs.length) return { pos: new THREE.Vector3(0, 46, 0.01), quat: topDownQuat() };
  const halfZ = (PLANE_H / 2) * SIN_2D; // a reclined page's footprint along the timeline
  const zMin = Math.min(...zs) - halfZ - 1.6; // headroom for the date/subtitle block
  const zMax = Math.max(...zs) + halfZ + 0.4;
  const y = fitDistance((PLANE_W + 1.2) / 2, (zMax - zMin) / 2, camera, 1.04);
  return { pos: new THREE.Vector3(0, y, (zMin + zMax) / 2), quat: topDownQuat() };
}

// where the camera should end up to frame a focused page
function framing(
  base: [number, number, number],
  mode: "max" | "sel",
  viewMode: "2d" | "3d",
  camera: THREE.Camera
): { pos: THREE.Vector3; quat: THREE.Quaternion } {
  const [bx, , bz] = base;
  if (viewMode === "2d") {
    // Square up on the page's FACE, not merely overhead: the pages are reclined by
    // TILT_2D, so the camera sits along the page normal and adopts its up vector.
    // Aim a little above centre (the date/subtitle block and window controls live
    // there) and fit the distance so page + labels nearly fill the frame.
    const { v, n } = poseBasis(TILT_2D, 0);
    const centre = new THREE.Vector3(bx, 0, bz).addScaledVector(v, PAGE_AIM_Y);
    // pad 1.02: the page + its date/subtitle block fill the frame edge to edge, so
    // card body text is legible without a further zoom, and nothing is cropped
    const pos = centre
      .clone()
      .addScaledVector(n, fitDistance(PLANE_W / 2, PAGE_HALF_H, camera, 1.02));
    const m = new THREE.Matrix4().lookAt(pos, centre, v);
    return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
  }
  if (mode === "max") {
    // the page glides LIFT_MAX toward us → net framing distance stays 13
    return {
      pos: new THREE.Vector3(bx, 0.8, bz + LIFT_MAX + 13),
      quat: new THREE.Quaternion(), // identity looks down -Z, straight at the page
    };
  }
  const centre = new THREE.Vector3(bx, LIFT_SELECT_Y + 0.4, bz);
  const pos = new THREE.Vector3(bx, LIFT_SELECT_Y + SELECT_ELEV, bz + SELECT_DIST);
  const m = new THREE.Matrix4().lookAt(pos, centre, new THREE.Vector3(0, 1, 0));
  return { pos, quat: new THREE.Quaternion().setFromRotationMatrix(m) };
}

function CameraRig({
  positions,
  basePositions,
  pageOrder,
  setLifts,
  setTilt,
}: {
  positions: Record<string, [number, number, number]>; // live, for F-framing
  basePositions: Record<string, [number, number, number]>; // resting slots (stable)
  pageOrder: string[]; // chronological, visible pages only — drives the 2D reset point
  setLifts: (l: Record<string, PageLift>) => void;
  setTilt: (t: number) => void;
}) {
  const { camera, gl } = useThree();
  const keys = useRef<Set<string>>(new Set());
  const vel = useRef(new THREE.Vector3());
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const dragging = useRef<{ mode: "rotate" | "pan" | null; x: number; y: number }>({
    mode: null, x: 0, y: 0,
  });

  // damped free flight (focus / home / F-frame)
  const flyTo = useRef<THREE.Vector3 | null>(null);
  const targetQuat = useRef<THREE.Quaternion | null>(null);
  // scripted focus flight; the rig is the sole writer of lifts and tilt
  const flight = useRef<Flight>({
    running: false, owns: false, moveCamera: false, u: 0,
    from: new THREE.Vector3(), to: new THREE.Vector3(),
    fromQ: new THREE.Quaternion(), toQ: new THREE.Quaternion(),
    liftFrom: {}, liftTo: {},
  });
  const lifts = useRef<Record<string, PageLift>>({});
  const tilt = useRef(0);

  const positionsRef = useRef(positions);
  const baseRef = useRef(basePositions);
  const orderRef = useRef(pageOrder);
  useEffect(() => {
    positionsRef.current = positions;
    baseRef.current = basePositions;
    orderRef.current = pageOrder;
  });

  const viewMode = useAppStore((s) => s.viewMode);
  const selection = useAppStore((s) => s.selection);
  const maximizedPlane = useAppStore((s) => s.maximizedPlane);
  const focusRequest = useAppStore((s) => s.focusRequest);
  const resetRequest = useAppStore((s) => s.resetRequest);

  // Manual camera input hands control back to the user: the rig keeps easing the
  // page lifts but stops writing to the camera.
  const takeOver = useCallback(() => {
    flight.current.owns = false;
    flyTo.current = null;
  }, []);

  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion);
  }, [camera]);

  // Fly (never snap) to the reset point of the given view. Everything that "resets"
  // — the button, the Enter shortcut, entering 2D — funnels through here, so there
  // is exactly one definition of home per view.
  const goHome = useCallback(
    (mode: "2d" | "3d") => {
      flight.current.owns = false;
      const h =
        mode === "2d" ? home2D(orderRef.current, baseRef.current, camera) : home3D();
      flyTo.current = h.pos;
      targetQuat.current = h.quat;
    },
    [camera]
  );

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      keys.current.add(e.code);
      if (e.code === "Escape") useAppStore.getState().setMaximizedPlane(null);
      // Enter — global "return to the reset point of the current view". Works while
      // a page is selected or maximized; requestReset() is the single entry point so
      // it behaves exactly like the Reset Position button.
      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        useAppStore.getState().requestReset();
      }
      if (e.code === "KeyF") {
        const sel = useAppStore.getState().selection;
        const pts = sel.map((id) => positionsRef.current[id]).filter(Boolean);
        if (pts.length) {
          const c = pts
            .reduce((acc, p) => acc.add(new THREE.Vector3(...p)), new THREE.Vector3())
            .divideScalar(pts.length);
          const dir = camera.getWorldDirection(new THREE.Vector3());
          takeOver();
          flyTo.current =
            useAppStore.getState().viewMode === "2d"
              ? new THREE.Vector3(c.x, Math.max(camera.position.y, 30), c.z)
              : c.clone().addScaledVector(dir, -9);
        }
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera, takeOver]);

  // mouse: RMB rotate / MMB pan / wheel dolly
  useEffect(() => {
    const dom = gl.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button === 2) dragging.current = { mode: "rotate", x: e.clientX, y: e.clientY };
      if (e.button === 1) {
        e.preventDefault();
        dragging.current = { mode: "pan", x: e.clientX, y: e.clientY };
      }
    };
    const onMove = (e: PointerEvent) => {
      const d = dragging.current;
      if (!d.mode) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      dragging.current = { ...d, x: e.clientX, y: e.clientY };
      if (d.mode === "rotate" && useAppStore.getState().viewMode === "3d") {
        takeOver();
        targetQuat.current = null;
        euler.current.setFromQuaternion(camera.quaternion);
        euler.current.y -= dx * 0.0042;
        euler.current.x = THREE.MathUtils.clamp(euler.current.x - dy * 0.0042, -1.45, 1.45);
        camera.quaternion.setFromEuler(euler.current);
      }
      if (d.mode === "pan") {
        const scale = 0.0022 * camera.position.length();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(right, -dx * scale).addScaledVector(upv, dy * scale);
        takeOver();
      }
    };
    const onUp = () => (dragging.current = { mode: null, x: 0, y: 0 });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      flight.current.owns = false;
      if (useAppStore.getState().viewMode !== "2d") {
        flyTo.current = null;
        camera.translateZ(e.deltaY * 0.012); // 3D: dolly along the view axis
        return;
      }
      // 2D reads like a document: the wheel scrolls along the timeline, ctrl/⌘+wheel
      // zooms. Both retarget the damped flight instead of jumping, so a burst of wheel
      // events glides to rest rather than stuttering frame by frame.
      const from = flyTo.current ?? camera.position;
      const next = from.clone();
      if (e.ctrlKey || e.metaKey) {
        next.y = THREE.MathUtils.clamp(next.y + e.deltaY * 0.05, 8, 120);
      } else {
        next.z += e.deltaY * 0.0012 * camera.position.y; // scroll step scales with altitude
      }
      flyTo.current = next;
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onCtx);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onCtx);
    };
  }, [camera, gl, takeOver]);

  // double-click / sidebar focus request
  useEffect(() => {
    if (!focusRequest) return;
    const p = new THREE.Vector3(...focusRequest.point);
    takeOver();
    if (useAppStore.getState().viewMode === "2d") {
      flyTo.current = new THREE.Vector3(p.x, Math.max(camera.position.y, 28), p.z);
    } else {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      flyTo.current = p.clone().addScaledVector(dir, -8);
    }
  }, [focusRequest, camera, takeOver]);

  // Reset Position (button or Enter) — recover after drifting away. Maximized
  // isolation hides every other page, so it cannot survive a camera reset: leaving
  // it is what makes the home framing meaningful again. A selection may stay.
  useEffect(() => {
    if (!resetRequest) return;
    useAppStore.getState().setMaximizedPlane(null);
    goHome(useAppStore.getState().viewMode);
  }, [resetRequest, goHome]);

  // 2D/3D transition: camera-only, context preserved — each view lands on its own
  // reset point. Declared BEFORE the focus effect so that, when a page is focused,
  // the focus flight below overrides this home flight in the same commit.
  useEffect(() => {
    goHome(viewMode);
  }, [viewMode, goHome]);

  // focus changes (maximize / select / deselect / view mode) start a new flight
  const focusId =
    maximizedPlane ?? (selection.length === 1 && basePositions[selection[0]] ? selection[0] : null);
  const mode: "max" | "sel" | null = maximizedPlane ? "max" : focusId ? "sel" : null;
  const key = `${viewMode}|${mode}|${focusId}`;
  const lastKey = useRef("");

  useEffect(() => {
    if (key === lastKey.current) return;
    lastKey.current = key;
    const base = baseRef.current;
    const liftTo: Record<string, PageLift> = {};
    const liftFrom: Record<string, PageLift> = {};
    // The lift is a 3D affordance — it raises a page clear of the row it sits in.
    // Overhead in 2D there is no row to rise above, and lifting only drags the
    // page toward the camera, which pulls its neighbours back into frame. So in
    // 2D the pages never move: the camera zoom alone does the isolating.
    const lifted = viewMode === "3d";
    for (const id of Object.keys(base)) {
      liftFrom[id] = lifts.current[id] ?? { y: 0, f: 0 };
      liftTo[id] =
        id === focusId && lifted
          ? mode === "max"
            ? { y: 0, f: LIFT_MAX }
            : { y: LIFT_SELECT_Y, f: 0 }
          : { y: 0, f: 0 };
    }
    const target =
      focusId && mode && base[focusId] ? framing(base[focusId], mode, viewMode, camera) : null;
    const settled = Object.keys(liftTo).every(
      (id) =>
        Math.abs(liftFrom[id].y - liftTo[id].y) < 0.001 &&
        Math.abs(liftFrom[id].f - liftTo[id].f) < 0.001
    );
    if (!target && settled) return; // nothing to animate (e.g. first mount)

    const f = flight.current;
    f.liftFrom = liftFrom;
    f.liftTo = liftTo;
    f.moveCamera = !!target;
    if (target) {
      f.from.copy(camera.position);
      f.fromQ.copy(camera.quaternion);
      f.to.copy(target.pos);
      f.toQ.copy(target.quat);
      // the rig owns the camera now — cancel any damped flight already under way
      flyTo.current = null;
      targetQuat.current = null;
    }
    f.u = 0;
    f.owns = true;
    f.running = true;
  }, [key, focusId, mode, viewMode, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);

    // global recline of every page (2D ⇄ 3D), damped and self-terminating
    const tiltTarget = viewMode === "2d" ? TILT_2D : 0;
    if (tilt.current !== tiltTarget) {
      const next =
        Math.abs(tilt.current - tiltTarget) < 0.0015
          ? tiltTarget
          : tilt.current + (tiltTarget - tilt.current) * (1 - Math.exp(-6 * dt));
      tilt.current = next;
      setTilt(next);
    }

    // free-fly input
    const k = keys.current;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 28 : 10;
    const input = new THREE.Vector3(
      (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0),
      (k.has("KeyE") ? 1 : 0) - (k.has("KeyQ") ? 1 : 0),
      (k.has("KeyS") ? 1 : 0) - (k.has("KeyW") ? 1 : 0)
    );
    vel.current.lerp(input.multiplyScalar(speed), 1 - Math.exp(-12 * dt));
    if (vel.current.lengthSq() > 0.0001) {
      takeOver();
      if (viewMode === "2d") {
        camera.position.x += vel.current.x * dt;
        camera.position.z += vel.current.z * dt;
        camera.position.y = THREE.MathUtils.clamp(
          camera.position.y + vel.current.y * dt, 8, 120
        );
      } else {
        camera.translateX(vel.current.x * dt);
        camera.translateY(vel.current.y * dt);
        camera.translateZ(vel.current.z * dt);
      }
    }

    // scripted focus flight: camera and page lifts share the same eased progress
    const f = flight.current;
    if (f.running) {
      f.u = Math.min(1, f.u + dt / FOCUS_DUR);
      const p = easeInOutCubic(f.u);
      const next: Record<string, PageLift> = {};
      for (const id of Object.keys(f.liftTo)) {
        const a = f.liftFrom[id] ?? { y: 0, f: 0 };
        const b = f.liftTo[id];
        next[id] = { y: a.y + (b.y - a.y) * p, f: a.f + (b.f - a.f) * p };
      }
      lifts.current = next;
      setLifts(next);
      if (f.owns && f.moveCamera) {
        camera.position.lerpVectors(f.from, f.to, p);
        camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, p);
      }
      if (f.u >= 1) {
        f.running = false;
        f.owns = false;
      }
    }

    // damped free flight (only when the scripted flight is not driving)
    if (!(f.running && f.owns && f.moveCamera)) {
      if (flyTo.current) {
        camera.position.lerp(flyTo.current, 1 - Math.exp(-6 * dt));
        if (camera.position.distanceTo(flyTo.current) < 0.03) flyTo.current = null;
      }
      if (targetQuat.current) {
        camera.quaternion.slerp(targetQuat.current, 1 - Math.exp(-7 * dt));
        if (camera.quaternion.angleTo(targetQuat.current) < 0.005) {
          camera.quaternion.copy(targetQuat.current);
          targetQuat.current = null;
        }
      }
    }
  });

  return null;
}

// ---------- box select resolver ----------
function BoxSelectResolver({
  rect,
  positions,
  onResolved,
}: {
  rect: { x1: number; y1: number; x2: number; y2: number; additive: boolean } | null;
  positions: Record<string, [number, number, number]>;
  onResolved: () => void;
}) {
  const { camera, size } = useThree();
  const setSelection = useAppStore((s) => s.setSelection);
  const selection = useAppStore((s) => s.selection);

  useEffect(() => {
    if (!rect) return;
    const [minX, maxX] = [Math.min(rect.x1, rect.x2), Math.max(rect.x1, rect.x2)];
    const [minY, maxY] = [Math.min(rect.y1, rect.y2), Math.max(rect.y1, rect.y2)];
    const hit: string[] = [];
    for (const [id, p] of Object.entries(positions)) {
      const v = new THREE.Vector3(...p).project(camera);
      if (v.z > 1) continue;
      const sx = ((v.x + 1) / 2) * size.width;
      const sy = ((1 - v.y) / 2) * size.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) hit.push(id);
    }
    setSelection(rect.additive ? [...new Set([...selection, ...hit])] : hit);
    onResolved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect]);
  return null;
}

// ---------- star toggle (shared by cards & planes) ----------
function StarToggle({
  itemId,
  position,
  fontSize = 0.26,
  opacity = 1,
}: {
  itemId: string;
  position: [number, number, number];
  fontSize?: number;
  opacity?: number;
}) {
  const starGroups = useAppStore((s) => s.starGroups);
  const toggleStar = useAppStore((s) => s.toggleStar);
  const starred = starGroups.some((g) => g.items.includes(itemId));
  return (
    <Text
      position={position}
      fontSize={fontSize}
      anchorX="right"
      anchorY="top"
      color={starred ? "#F59F00" : "#ADB5BD"}
      renderOrder={12}
      opacity={opacity}
      onClick={(e) => {
        e.stopPropagation();
        toggleStar(itemId);
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "default")}
    >
      {starred ? "★" : "☆"}
    </Text>
  );
}

// A card drag must not also start a box-select. The r3f pointer handlers run on the
// canvas element's native listeners, i.e. before React's delegated handler on the
// wrapper div — so a plain module flag set on grip-down is already visible there.
const cardDrag = { active: false };

// grip dots (2×3), drawn as geometry rather than a glyph so no font can drop it
const GRIP_DOTS: [number, number][] = [-0.05, 0.05].flatMap((x) =>
  [-0.07, 0, 0.07].map((y) => [x, y] as [number, number])
);

// ---------- claim card (billboard) ----------
function ClaimNode({
  claim,
  pos,
  local,
  pose,
  agg,
  evidence,
  conflict,
}: {
  claim: GraphPayload["claims"][number];
  pos: [number, number, number];
  local: [number, number]; // plane-local coords (what cardPositions persists)
  pose: PlanePose; // the page's pose (for tilt/rotation-aware dragging)
  agg: ClaimAggregate;
  evidence: EvidenceRecord[];
  conflict?: { self: boolean }; // this claim cannot coexist with another live claim
}) {
  const selection = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  const toggleSelect = useAppStore((s) => s.toggleSelect);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const setCardPosition = useAppStore((s) => s.setCardPosition);
  const selected = selection.includes(claim.id);
  const rejected = claim.status === "rejected" || claim.testimony_status === "rejected";
  const flagged = claim.coherence_flags.length > 0;
  const [hover, setHover] = useState(false);
  const [expanded, setExpanded] = useState(false); // "See more" stair disclosure
  const [grip, setGrip] = useState(false);
  const [dragging, setDragging] = useState(false);

  // The grip handle drags the card across its page, design-tool style: the pointer
  // ray is intersected with the page's (lifted, tilted) plane and converted to
  // plane-local coords — the same space cardPositions persists.
  const basis = useMemo(() => poseBasis(pose.tilt, pose.rotY), [pose.tilt, pose.rotY]);
  const [px, py, pz] = pose.position;
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const dragPoint = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const c = new THREE.Vector3(px, py, pz);
      const denom = e.ray.direction.dot(basis.n);
      if (Math.abs(denom) < 0.05) return null; // ray grazes the page
      const t = c.clone().sub(e.ray.origin).dot(basis.n) / denom;
      if (!isFinite(t) || t <= 0) return null;
      const hit = e.ray.origin.clone().addScaledVector(e.ray.direction, t).sub(c);
      return { x: hit.dot(basis.u), y: hit.dot(basis.v) };
    },
    [basis, px, py, pz]
  );
  const onGripDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.nativeEvent.button !== 0) return;
      e.stopPropagation();
      const p = dragPoint(e);
      if (!p) return;
      drag.current = { dx: local[0] - p.x, dy: local[1] - p.y };
      cardDrag.active = true;
      setDragging(true);
      setSelection([claim.id]);
      document.body.style.cursor = "grabbing";
      (e.target as Element).setPointerCapture(e.pointerId);
    },
    [dragPoint, local, claim.id, setSelection]
  );
  const onGripMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!drag.current) {
        document.body.style.cursor = "grab"; // repairs the cursor after a card pointer-out
        return;
      }
      const p = dragPoint(e);
      if (!p) return;
      setCardPosition(claim.id, [
        THREE.MathUtils.clamp(p.x + drag.current.dx, -CARD_X_MAX, CARD_X_MAX),
        THREE.MathUtils.clamp(p.y + drag.current.dy, -CARD_Y_MAX, CARD_Y_MAX),
      ]);
    },
    [dragPoint, setCardPosition, claim.id]
  );
  const onGripUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (drag.current) (e.target as Element).releasePointerCapture(e.pointerId);
    drag.current = null;
    cardDrag.active = false;
    setDragging(false);
    document.body.style.cursor = "grab";
  }, []);

  const onClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.nativeEvent.ctrlKey || e.nativeEvent.metaKey || e.nativeEvent.shiftKey)
        toggleSelect(claim.id);
      else setSelection([claim.id]);
    },
    [claim.id, setSelection, toggleSelect]
  );

  // A live contradiction outranks every other card state: an investigator must see
  // it before they see hover, flags, or selection chrome.
  const inConflict = !!conflict && !rejected;
  const border = inConflict
    ? "#E03131"
    : selected
    ? "#1971C2"
    : rejected
    ? "#CED4DA"
    : flagged
    ? "#E8590C"
    : hover
    ? "#74A9D8"
    : "#DEE2E6";
  const face = rejected ? "#E9ECEF" : inConflict ? "#FFF5F5" : "#FFFFFF";
  const gripActive = grip || dragging;

  // NOTE: card surfaces render in the transparent pass with a raised renderOrder
  // (and depthTest off) so acrylic planes can never tint/"shadow" them. Card TEXT
  // keeps depth testing so an overlapping card in front correctly occludes the
  // text of cards behind it (cards are freely draggable via their grip handle).
  return (
    <Billboard position={pos}>
      <mesh
        renderOrder={10}
        onClick={onClick}
        onDoubleClick={(e) => {
          e.stopPropagation();
          requestFocus(pos);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "default";
        }}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        {/* fully opaque — drawn after the translucent planes (renderOrder) so
            nothing behind the card ever shows through or tints it */}
        <meshBasicMaterial color={face} transparent opacity={1} />
      </mesh>
      <lineSegments position={[0, 0, 0.002]} renderOrder={11}>
        <edgesGeometry args={[new THREE.PlaneGeometry(CARD_W, CARD_H)]} />
        <lineBasicMaterial color={border} transparent />
      </lineSegments>
      {/* a second, inset stroke doubles the red edge so the card reads as alarmed
          even at the distance the 3D home view puts it at */}
      {inConflict && (
        <lineSegments position={[0, 0, 0.002]} scale={[0.985, 0.97, 1]} renderOrder={11}>
          <edgesGeometry args={[new THREE.PlaneGeometry(CARD_W, CARD_H)]} />
          <lineBasicMaterial color="#E03131" transparent />
        </lineSegments>
      )}
      {selected && (
        <lineSegments position={[0, 0, 0.002]} scale={[1.03, 1.06, 1]} renderOrder={11}>
          <edgesGeometry args={[new THREE.PlaneGeometry(CARD_W, CARD_H)]} />
          <lineBasicMaterial color="#1971C2" depthTest={false} transparent />
        </lineSegments>
      )}

      {/* grip handle — drag to reposition this bulletin on its page */}
      <group position={[-2.14, 0.87, 0.01]}>
        <mesh
          renderOrder={11}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onPointerOver={(e) => {
            e.stopPropagation();
            setGrip(true);
            document.body.style.cursor = "grab";
          }}
          onPointerOut={() => {
            setGrip(false);
            if (!drag.current) document.body.style.cursor = "default";
          }}
        >
          <planeGeometry args={[0.26, 0.26]} />
          <meshBasicMaterial color={gripActive ? "#E7F0F8" : "#FFFFFF"} transparent opacity={1} />
        </mesh>
        <lineSegments position={[0, 0, 0.001]} renderOrder={11}>
          <edgesGeometry args={[new THREE.PlaneGeometry(0.26, 0.26)]} />
          <lineBasicMaterial color={gripActive ? "#1971C2" : "#DEE2E6"} transparent />
        </lineSegments>
        {GRIP_DOTS.map(([gx, gy]) => (
          <mesh key={`${gx},${gy}`} position={[gx, gy, 0.002]} renderOrder={12}>
            <circleGeometry args={[0.019, 10]} />
            <meshBasicMaterial color={gripActive ? "#1971C2" : "#ADB5BD"} />
          </mesh>
        ))}
      </group>

      {/* NON-COHERENT TESTIMONY — sits in the free strip between the grip handle
          (x ≈ -2.0) and the star (x ≈ 1.65), above the title's first line */}
      {inConflict && (
        <Text
          position={[-0.2, 0.95, 0.01]}
          fontSize={0.135}
          fontWeight={700}
          letterSpacing={0.06}
          color="#E03131"
          renderOrder={12}
        >
          {t("conflict.badge")}
        </Text>
      )}

      {/* uniform left edge (-2.08), consistent letter spacing & line rhythm.
          The title starts below the grip handle so the two never collide. */}
      <Text
        position={[-2.08, 0.66, 0.01]}
        fontSize={0.22}
        maxWidth={3.85}
        lineHeight={1.3}
        letterSpacing={0.01}
        anchorX="left"
        anchorY="top"
        color={rejected ? "#868E96" : "#343A40"}
        renderOrder={12}
      >
        {claim.text.length > 80 ? claim.text.slice(0, 80) + "…" : claim.text}
      </Text>
      <StarToggle itemId={claim.id} position={[1.8, 0.94, 0.01]} />
      {/* delete bulletin — confirmed, then removed from the database */}
      <Text
        position={[2.16, 0.94, 0.01]}
        fontSize={0.24}
        anchorX="right"
        anchorY="top"
        color="#ADB5BD"
        renderOrder={12}
        onClick={(e) => {
          e.stopPropagation();
          void (async () => {
            if (!window.confirm(t("card.deleteConfirm"))) return;
            try {
              await api(`/api/claims/${claim.id}`, { method: "DELETE" });
            } catch (err) {
              window.alert(
                `Delete failed: ${err instanceof Error ? err.message : err}`
              );
              return;
            }
            useAppStore.getState().setSelection([]);
            useAppStore.getState().bumpGraph();
          })();
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "default")}
      >
        ✕
      </Text>
      {/* attribution line: who said it, and on what date they said it */}
      <Text
        position={[-2.08, -0.5, 0.01]}
        fontSize={0.15}
        letterSpacing={0.02}
        anchorX="left"
        anchorY="top"
        color={inConflict ? "#C92A2A" : "#868E96"}
        renderOrder={12}
      >
        {[
          claim.source_label ?? "?",
          claim.given_at ? claim.given_at.slice(0, 10) : null,
          rejected ? "REJECTED" : null,
          flagged ? "⚠" : null,
        ]
          .filter(Boolean)
          .join("  ·  ")}
      </Text>
      <Text
        position={[-2.08, -0.76, 0.01]}
        fontSize={0.16}
        letterSpacing={0.02}
        anchorX="left"
        anchorY="top"
        color={rejected ? "#ADB5BD" : "#1971C2"}
        renderOrder={12}
      >
        {`Supports ${agg.supports}  ·  Agreement ${agg.agreement}%  ·  ${agg.confidence}`}
      </Text>

      {/* Direct evidence: no green lines — "See more" stair expand/collapse */}
      {evidence.length > 0 && (
        <Text
          position={[2.12, -0.78, 0.01]}
          fontSize={0.16}
          anchorX="right"
          anchorY="top"
          color="#2F9E44"
          renderOrder={12}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          onPointerOver={() => (document.body.style.cursor = "pointer")}
          onPointerOut={() => (document.body.style.cursor = "default")}
        >
          {expanded ? `${t("card.seeLess")} ▴` : `${t("card.seeMore")} (${evidence.length}) ▾`}
        </Text>
      )}
      {expanded &&
        evidence.map((ev, i) => (
          // expanded rows align identically with the card above:
          // same width (4.6), same center x, same left text edge (-2.08)
          <group key={ev.id} position={[0, -1.42 - i * 0.66, 0.02]}>
            <mesh renderOrder={10}>
              <planeGeometry args={[4.6, 0.56]} />
              <meshBasicMaterial color="#FFFFFF" transparent opacity={1} />
            </mesh>
            <lineSegments position={[0, 0, 0.001]} renderOrder={11}>
              <edgesGeometry args={[new THREE.PlaneGeometry(4.6, 0.56)]} />
              <lineBasicMaterial color="#2F9E44" transparent />
            </lineSegments>
            <Text
              position={[-2.08, 0.09, 0.01]}
              fontSize={0.15}
              maxWidth={4.2}
              letterSpacing={0.02}
              anchorX="left"
              anchorY="top"
              color="#2F9E44"
              renderOrder={12}
            >
              {`📄 ${ev.title ?? "evidence"}${ev.provenance ? ` — ${ev.provenance}` : ""}`}
            </Text>
          </group>
        ))}
    </Billboard>
  );
}

// ---------- page window buttons (browser-style − □ ✕) ----------
function PlaneButton({
  x,
  y,
  glyph,
  danger,
  onClick,
}: {
  x: number;
  y: number;
  glyph: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <group position={[x, y, 0.01]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "default";
        }}
      >
        <planeGeometry args={[0.48, 0.48]} />
        <meshBasicMaterial
          color={hover ? (danger ? "#E03131" : "#E7F0F8") : "#FFFFFF"}
          transparent
          opacity={1}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(0.48, 0.48)]} />
        <lineBasicMaterial color={hover ? (danger ? "#E03131" : "#1971C2") : "#CED4DA"} transparent />
      </lineSegments>
      <Text
        position={[0, 0.01, 0.02]}
        fontSize={0.22}
        fontWeight={600}
        color={hover ? (danger ? "#FFFFFF" : "#1971C2") : "#495057"}
        renderOrder={5}
      >
        {glyph}
      </Text>
    </group>
  );
}

// ---------- plane (acrylic board / "page") ----------
// Date is the PRIMARY label — the timeline is the most important attribute.
// The AI-generated day summary is the subtitle beneath it.
// Top-right window controls: minimize (dock to the bottom tab strip) ·
// maximize toggle (isolated head-on view) · delete (hide; restorable).
function PlaneNode({
  plane,
  focusPoint,
}: {
  plane: GraphPayload["planes"][number];
  focusPoint: [number, number, number]; // world point for double-click focus
}) {
  const selection = useAppStore((s) => s.selection);
  const setSelection = useAppStore((s) => s.setSelection);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const minimizePlane = useAppStore((s) => s.minimizePlane);
  const maximizedPlane = useAppStore((s) => s.maximizedPlane);
  const setMaximizedPlane = useAppStore((s) => s.setMaximizedPlane);
  const selected = selection.includes(plane.id);
  const isMaximized = maximizedPlane === plane.id;
  const isPage = plane.id !== "__orphan__"; // the synthetic orphan strip has no window controls

  const controlsY = PLANE_H / 2 + 1.05;
  // click toggles: clicking a selected page returns it to its stored slot
  const select = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (selected) clearSelection();
    else setSelection([plane.id]);
  };

  // permanent page deletion (user-confirmed): removes the event and every
  // testimony that contributed a claim to it from the database
  const deletePage = async () => {
    if (!window.confirm(t("page.deleteConfirm"))) return;
    try {
      await api(`/api/events/${plane.id}`, { method: "DELETE" });
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    useAppStore.getState().hidePlane(plane.id); // instant UI cleanup
    useAppStore.getState().bumpGraph(); // refetch graph + testimonies
  };

  return (
    <group>
      <mesh
        onClick={select}
        onDoubleClick={(e) => {
          e.stopPropagation();
          requestFocus(focusPoint);
        }}
      >
        <planeGeometry args={[PLANE_W, PLANE_H]} />
        <meshBasicMaterial
          color="#1971C2"
          transparent
          opacity={selected ? 0.1 : 0.04}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(PLANE_W, PLANE_H)]} />
        <lineBasicMaterial color={selected ? "#1971C2" : "#C4D7E8"} />
      </lineSegments>
      {/* Date (PRIMARY) + AI day summary, billboarded as one block so they always
          face the camera and keep their relative rhythm. The pivot is the block's
          left edge, matching the labels' anchorX="left".
          Materials are deliberately left at the CanvasText defaults (renderOrder 0,
          depthTest + depthWrite on): that is the same depth-based layering rule the
          page window buttons use, and it is what fixed the label/card overlap. Only
          the orientation changes here — never the layering. */}
      <Billboard position={[-PLANE_W / 2 + 0.15, PLANE_H / 2 + 0.7, 0]}>
        <Text
          position={[0, 0.3, 0]}
          fontSize={0.46}
          letterSpacing={0.02}
          anchorX="left"
          fontWeight={600}
          color={selected ? "#1971C2" : "#343A40"}
        >
          {plane.occurred_at ? plane.occurred_at.slice(0, 10) : "Date unknown"}
        </Text>
        <Text
          position={[0, -0.3, 0]}
          fontSize={0.27}
          letterSpacing={0.01}
          maxWidth={PLANE_W - 1.2}
          anchorX="left"
          color="#495057"
        >
          {plane.ai_subtitle ?? plane.title}
        </Text>
      </Billboard>
      {isPage && (
        <>
          <StarToggle
            itemId={plane.id}
            position={[PLANE_W / 2 - 1.85, controlsY + 0.18, 0]}
            fontSize={0.34}
          />
          {/* window controls: − □/❐ ✕ (minimize docks to the bottom tab strip;
              maximize is a toggle — clicking ❐ restores the normal view) */}
          <PlaneButton
            x={PLANE_W / 2 - 1.38}
            y={controlsY}
            glyph="—"
            onClick={() => minimizePlane(plane.id)}
          />
          <PlaneButton
            x={PLANE_W / 2 - 0.85}
            y={controlsY}
            glyph={isMaximized ? "❐" : "□"}
            onClick={() => setMaximizedPlane(isMaximized ? null : plane.id)}
          />
          <PlaneButton
            x={PLANE_W / 2 - 0.32}
            y={controlsY}
            glyph="✕"
            danger
            onClick={() => void deletePage()}
          />
        </>
      )}
    </group>
  );
}

// ---------- main ----------
export function TimePlaneCanvas({ graph }: { graph: GraphPayload }) {
  const cardPositions = useAppStore((s) => s.cardPositions);
  const minimizedPlanes = useAppStore((s) => s.minimizedPlanes);
  const hiddenPlanes = useAppStore((s) => s.hiddenPlanes);
  const maximizedPlane = useAppStore((s) => s.maximizedPlane);
  const viewMode = useAppStore((s) => s.viewMode);

  // Animated scene state, both published by CameraRig from inside the canvas:
  // - lifts: per-page rise (selection) / forward glide (maximized)
  // - tilt:  global recline of every page toward the 2D overhead camera
  const [lifts, setLifts] = useState<Record<string, PageLift>>({});
  const [tilt, setTilt] = useState(0);

  const pageGap = useAppStore((s) => s.pageGap);
  // resting slots only — stable across lift/tilt frames, so the rig can depend on it
  const { basePositions, pageOrder } = useMemo(() => {
    const { planes: ps, poses } = computeLayout(graph, { hidden: hiddenPlanes, gap: pageGap });
    const out: Record<string, [number, number, number]> = {};
    for (const [id, p] of Object.entries(poses)) out[id] = p.basePosition;
    return {
      basePositions: out,
      // chronological, visible pages — the 2D reset point frames the first few
      pageOrder: ps
        .filter((p) => p.id !== "__orphan__" && !minimizedPlanes.includes(p.id))
        .map((p) => p.id),
    };
  }, [graph, hiddenPlanes, pageGap, minimizedPlanes]);
  const { planes, positions, locals, poses } = useMemo(
    () =>
      computeLayout(graph, {
        cardPositions,
        minimized: minimizedPlanes,
        hidden: hiddenPlanes,
        gap: pageGap,
        lifts,
        tilt,
      }),
    [graph, cardPositions, minimizedPlanes, hiddenPlanes, pageGap, lifts, tilt]
  );
  const aggregates = useMemo(() => computeAggregates(graph), [graph]);
  // read straight from the stored LLM analysis that travels with the graph payload
  const conflicts = useMemo(() => conflictByClaim(conflictPairs(graph)), [graph]);
  const conflictLinks = useMemo(() => conflictLinkIds(graph), [graph]);
  const clearSelection = useAppStore((s) => s.clearSelection);
  const planeOfClaim = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of graph.claims) m[c.id] = c.event_id ?? "__orphan__";
    return m;
  }, [graph]);

  // direct evidence per claim (rendered inside the card via "See more")
  const evidenceByClaim = useMemo(() => {
    const map: Record<string, EvidenceRecord[]> = {};
    for (const l of graph.links) {
      if (l.kind !== "direct_evidence" || !l.evidence_id) continue;
      const ev = graph.evidence.find((e) => e.id === l.evidence_id);
      if (!ev) continue;
      (map[l.from_claim] ??= []).push(ev);
    }
    return map;
  }, [graph]);

  // box select overlay
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [resolved, setResolved] = useState<{
    x1: number; y1: number; x2: number; y2: number; additive: boolean;
  } | null>(null);
  const boxStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);

  // a card drag that ends outside the canvas must still clear the flag
  useEffect(() => {
    const clear = () => {
      cardDrag.active = false;
    };
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (cardDrag.active) return; // a grip handle took the pointer: no box select
    const r = wrapRef.current!.getBoundingClientRect();
    boxStart.current = {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      additive: e.ctrlKey || e.metaKey || e.shiftKey,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!boxStart.current) return;
    const r = wrapRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (
      box ||
      Math.abs(x - boxStart.current.x) > 6 ||
      Math.abs(y - boxStart.current.y) > 6
    )
      setBox({ x1: boxStart.current.x, y1: boxStart.current.y, x2: x, y2: y });
  };
  const onPointerUp = () => {
    if (box && boxStart.current)
      setResolved({ ...box, additive: boxStart.current.additive });
    setBox(null);
    boxStart.current = null;
  };

  const showAxis = planes.length > 0 && !maximizedPlane && viewMode === "3d";
  // "down" for the rope sag: the pages' local -Y, so links droop toward the bottom
  // of the screen in the reclined 2D view exactly as they do in 3D
  const sagUp = useMemo(() => poseBasis(tilt, 0).v, [tilt]);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Canvas
        flat // no tone mapping — design-system colors render exactly (white cards stay #FFFFFF)
        camera={{ position: HOME_POSITION, fov: 50 }}
        onPointerMissed={(e) => {
          if (e.button === 0 && !box) clearSelection();
        }}
      >
        <color attach="background" args={["#F8F9FA"]} />
        <CameraRig
          positions={{ ...positions, ...planePosObj(poses) }}
          basePositions={basePositions}
          pageOrder={pageOrder}
          setLifts={setLifts}
          setTilt={setTilt}
        />
        <BoxSelectResolver
          rect={resolved}
          positions={positions}
          onResolved={() => setResolved(null)}
        />

        {/* Time axis through the page slots. Hidden in maximized isolation, and in
            2D — there the pages already read top-to-bottom as a chronological stack,
            so the axis is redundant chrome across the reading surface. 3D is
            untouched: it hangs below each page along the page's own -Y. */}
        {showAxis && (
          <>
            <Line points={timeAxisPoints(planes, poses)} color="#ADB5BD" lineWidth={1} />
            <Billboard position={timeAxisLabelPos(planes, poses)}>
              <Text fontSize={0.3} color="#868E96">
                time →
              </Text>
            </Billboard>
          </>
        )}

        {/* maximized mode isolates the active page: every other page is hidden.
            Minimized pages keep their slot but render nothing (docked below). */}
        {planes.map((p) => {
          if (maximizedPlane && maximizedPlane !== p.id) return null;
          if (minimizedPlanes.includes(p.id)) return null;
          const pose = poses[p.id];
          return (
            <group
              key={p.id}
              position={pose.position}
              rotation={[pose.tilt, pose.rotY, 0]}
            >
              <PlaneNode plane={p} focusPoint={pose.position} />
            </group>
          );
        })}

        {graph.claims.map((c) => {
          if (!positions[c.id]) return null;
          if (maximizedPlane && maximizedPlane !== planeOfClaim[c.id]) return null;
          return (
            <ClaimNode
              key={c.id}
              claim={c}
              pos={positions[c.id]}
              local={locals[c.id]}
              pose={poses[planeOfClaim[c.id]]}
              agg={aggregates[c.id]}
              evidence={evidenceByClaim[c.id] ?? []}
              conflict={conflicts[c.id]}
            />
          );
        })}

        {/* claim-claim relationship lines (green evidence lines removed) */}
        {graph.links
          .filter((l) => l.to_claim)
          .map((l) => {
            const a = positions[l.from_claim];
            const b = positions[l.to_claim!];
            if (!a || !b) return null;
            if (
              maximizedPlane &&
              (planeOfClaim[l.from_claim] !== maximizedPlane ||
                planeOfClaim[l.to_claim!] !== maximizedPlane)
            )
              return null; // links touching hidden pages disappear with them
            const fc = graph.claims.find((c) => c.id === l.from_claim);
            const tc = graph.claims.find((c) => c.id === l.to_claim);
            const dim =
              fc?.testimony_status === "rejected" || tc?.testimony_status === "rejected";
            // A conflict line is not just "another relationship colour": it is drawn
            // heavier, fully opaque and above the rest, so a contradiction is legible
            // in a thicket of supports/inference lines. Membership comes from the
            // stored analysis, so the line disappears the moment the verdict does.
            const isConflict = conflictLinks.has(l.id) && !dim;
            return (
              <Line
                key={l.id}
                points={linkPoints(a, b, sagUp)}
                color={LINK_COLORS[l.kind as LinkKind]}
                lineWidth={dim ? 1 : isConflict ? 3.6 : 2}
                renderOrder={isConflict ? 3 : 1}
                transparent
                opacity={dim ? 0.15 : isConflict ? 1 : 0.8}
                dashed={l.kind === "weak_assoc" || l.kind === "inference"}
                dashSize={0.25}
                gapSize={0.15}
              />
            );
          })}
      </Canvas>

      {box && (
        <div
          className="pointer-events-none absolute z-10 border border-[#1971C2] bg-[#1971C2]/10"
          style={{
            left: Math.min(box.x1, box.x2),
            top: Math.min(box.y1, box.y2),
            width: Math.abs(box.x2 - box.x1),
            height: Math.abs(box.y2 - box.y1),
          }}
        />
      )}
    </div>
  );
}

// ---------- link routing ----------
// Straight segments, with just enough droop to read as a taut rope rather than a
// drafted vector. The sag is a small fraction of the span (and hard-capped), so
// short links are near-straight and long ones dip only slightly — never enough to
// wander off the path the eye expects between two cards.
// A quadratic's midpoint is (p0 + 2c + p1) / 4, so pulling the handle 2·sag along
// -up drops the belly of the curve by exactly `sag`.
const LINK_SAG = 0.045; // droop as a fraction of the span
const LINK_SAG_MAX = 0.8; // world units — a long link never sags more than this
const LINK_SAG_MIN = 0.03; // below this it is a straight line, not a rope

function linkPoints(
  a: [number, number, number],
  b: [number, number, number],
  up: THREE.Vector3 // the page's local +Y: gravity for the rope, in 3D and reclined 2D alike
): [number, number, number][] {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const sag = Math.min(LINK_SAG * A.distanceTo(B), LINK_SAG_MAX);
  if (sag < LINK_SAG_MIN) return [a, b];
  const handle = A.clone().add(B).multiplyScalar(0.5).addScaledVector(up, -2 * sag);
  return new THREE.QuadraticBezierCurve3(A, handle, B)
    .getPoints(14)
    .map((p) => [p.x, p.y, p.z] as [number, number, number]);
}

// plane poses as focusable positions (so F-framing and focus work on pages too)
function planePosObj(
  poses: Record<string, PlanePose>
): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const [id, p] of Object.entries(poses)) out[id] = p.position;
  return out;
}

// A point hanging `off` units below a page along the page's own -Y axis.
// Once the pages recline for the 2D camera, "below" points along the timeline
// itself, so the axis would run straight through them — slide it clear sideways
// in proportion to the recline. At tilt 0 (3D) the offset is exactly 0.
function belowPage(pose: PlanePose, off: number, alongZ = 0): [number, number, number] {
  const { v } = poseBasis(pose.tilt, pose.rotY);
  const b = pose.basePosition;
  const side = -(PLANE_W / 2 + 1) * Math.abs(Math.sin(pose.tilt));
  return [b[0] + v.x * off + side, b[1] + v.y * off, b[2] + v.z * off + alongZ];
}

// polyline through the page slots (resting poses), extended past both ends
function timeAxisPoints(
  planes: { id: string }[],
  poses: Record<string, PlanePose>
): [number, number, number][] {
  const off = -PLANE_H / 2 - 1;
  const pts = planes.map((p) => belowPage(poses[p.id], off));
  const first = poses[planes[0].id];
  const last = poses[planes[planes.length - 1].id];
  return [belowPage(first, off, -3), ...pts, belowPage(last, off, 3)];
}

function timeAxisLabelPos(
  planes: { id: string }[],
  poses: Record<string, PlanePose>
): [number, number, number] {
  return belowPage(poses[planes[planes.length - 1].id], -PLANE_H / 2 - 1.4, 3.4);
}
