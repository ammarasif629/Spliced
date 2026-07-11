"use client";
// Canvas-2D-rasterized text billboard label — replaces drei/troika <Text>.
// Why not troika: its SDF glyph shader hard-hangs the GPU on current Edge/Chromium
// ANGLE builds, which resets the WebGL context ("THREE.WebGLRenderer: Context Lost")
// and freezes the whole viewport. Rasterizing labels with canvas 2D uses only plain
// textured quads, works with system fonts (Korean included), and needs no font file.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";

const FONT_STACK = `"Segoe UI", "Malgun Gothic", system-ui, sans-serif`;
const PX_PER_UNIT = 160; // rasterization density: texture px per world unit

export interface CanvasTextProps {
  children?: React.ReactNode; // string/number content
  position?: [number, number, number];
  fontSize?: number; // world units, like troika
  color?: string;
  anchorX?: "left" | "center" | "right";
  anchorY?: "top" | "middle" | "bottom";
  maxWidth?: number; // world units — enables word wrap
  lineHeight?: number; // multiplier
  letterSpacing?: number; // em fraction of fontSize, like troika
  fontWeight?: number | string;
  renderOrder?: number;
  depthTest?: boolean;
  opacity?: number; // soft-focus dimming (background pages in maximized mode)
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  onDoubleClick?: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxPx: number | null): string[] {
  const paragraphs = text.split("\n");
  if (!maxPx) return paragraphs;
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(" ");
    let line = "";
    for (const word of words) {
      const probe = line ? line + " " + word : word;
      if (ctx.measureText(probe).width <= maxPx || !line) line = probe;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function buildLabel(
  text: string,
  fontPx: number,
  color: string,
  maxPx: number | null,
  lineHeightMul: number,
  letterSpacingEm: number,
  fontWeight: number | string
) {
  const canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d")!;
  const font = `${fontWeight} ${fontPx}px ${FONT_STACK}`;
  const applyStyle = (c: CanvasRenderingContext2D) => {
    c.font = font;
    // letterSpacing is supported in Chromium/Firefox; harmless elsewhere
    (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${
      letterSpacingEm * fontPx
    }px`;
  };
  applyStyle(ctx);
  const lines = wrapLines(ctx, text, maxPx);
  const linePx = Math.ceil(fontPx * lineHeightMul);
  const padX = Math.ceil(fontPx * 0.1); // keep antialiased edges off the texture border
  const width = Math.max(2, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2);
  const height = Math.max(2, linePx * lines.length);
  canvas.width = width;
  canvas.height = height;
  ctx = canvas.getContext("2d")!; // resizing resets state
  applyStyle(ctx);
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  lines.forEach((l, i) => ctx.fillText(l, padX, (i + 0.5) * linePx));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture, width, height, padX };
}

export function CanvasText({
  children,
  position,
  fontSize = 0.2,
  color = "#343A40",
  anchorX = "center",
  anchorY = "middle",
  maxWidth,
  lineHeight = 1.25,
  letterSpacing = 0,
  fontWeight = 500,
  renderOrder = 0,
  depthTest = true,
  opacity = 1,
  onClick,
  onDoubleClick,
  onPointerOver,
  onPointerOut,
}: CanvasTextProps) {
  const text = children == null ? "" : String(children);
  const label = useMemo(() => {
    if (!text.trim()) return null;
    return buildLabel(
      text,
      Math.round(fontSize * PX_PER_UNIT),
      color,
      maxWidth ? maxWidth * PX_PER_UNIT : null,
      lineHeight,
      letterSpacing,
      fontWeight
    );
  }, [text, fontSize, color, maxWidth, lineHeight, letterSpacing, fontWeight]);

  useEffect(() => {
    if (!label) return;
    return () => label.texture.dispose();
  }, [label]);

  if (!label) return null;
  const w = label.width / PX_PER_UNIT;
  const h = label.height / PX_PER_UNIT;
  const pad = label.padX / PX_PER_UNIT;
  const ox = anchorX === "left" ? w / 2 - pad : anchorX === "right" ? -w / 2 + pad : 0;
  const oy = anchorY === "top" ? -h / 2 : anchorY === "bottom" ? h / 2 : 0;

  return (
    <group position={position}>
      <mesh
        position={[ox, oy, 0]}
        renderOrder={renderOrder}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <planeGeometry args={[w, h]} />
        {/* Same layering rule as the PlaneButton chrome: glyph pixels write depth
            (alphaTest skips the transparent quad area), so later-drawn cards behind
            the label are occluded by it and cards in front still cover it — plain
            depth-based occlusion, never permanently on top. */}
        <meshBasicMaterial
          map={label.texture}
          transparent
          opacity={opacity}
          alphaTest={0.15}
          depthTest={depthTest}
          depthWrite={depthTest && opacity > 0.99}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
