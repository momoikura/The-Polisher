import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { Easing, continueRender, delayRender, interpolate, useCurrentFrame } from "remotion";
import timing from "./timing.json";

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export type SceneId = keyof typeof timing;

export const INK = "#161616";
export const MUTED = "#5c5c5c";
export const GREEN = "#1a7f37";
export const RED = "#cf222e";
export const SANS = '"Mona Sans Variable", system-ui, sans-serif';
export const MONO = '"Monaspace Neon", Consolas, monospace';

export const sceneFrames = (id: SceneId) => (timing[id] as unknown as { frames: number }).frames;
export const lineAt = (id: SceneId, i: number) => Math.round(timing[id].lines[i].start * FPS);

const OUT = Easing.bezier(0.16, 1, 0.3, 1);
/** 0 to 1 from `start`, with a clean settle and no bounce. */
export const rise = (frame: number, start: number, dur = 16) =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });

export const Reveal = ({ at, children, y = 22, style }: { at: number; children: ReactNode; y?: number; style?: React.CSSProperties }) => {
  const p = rise(useCurrentFrame(), at);
  return <div style={{ opacity: p, translate: `0 ${(1 - p) * y}px`, ...style }}>{children}</div>;
};

export const typed = (text: string, frame: number, start: number, perChar = 1) => text.slice(0, Math.max(0, Math.floor((frame - start) / perChar)));

// ── Camera over the app, which is laid out at 1440px wide ──────────────────────

export const DESIGN_W = 1440;
export const BASE = WIDTH / DESIGN_W;
/** Vertical centre of the picture, leaving room for captions. */
export const CENTER_Y = (HEIGHT - 110) / 2;
export type Shot = { at: number; x: number; y: number; zoom: number };

export function cameraAt(shots: Shot[], frame: number, dur = 26): Shot {
  let cur = shots[0];
  for (const next of shots.slice(1)) {
    const p = rise(frame, next.at, dur);
    cur = { at: next.at, x: cur.x + (next.x - cur.x) * p, y: cur.y + (next.y - cur.y) * p, zoom: cur.zoom + (next.zoom - cur.zoom) * p };
  }
  return cur;
}

export const Camera = ({ x, y, zoom, children, rootRef }: { x: number; y: number; zoom: number; children: ReactNode; rootRef?: RefObject<HTMLDivElement | null> }) => {
  const s = BASE * zoom;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#fff" }}>
      <div ref={rootRef} style={{ position: "absolute", left: 0, top: 0, width: DESIGN_W, transformOrigin: "0 0", transform: `translate(${WIDTH / 2 - x * s}px, ${CENTER_Y - y * s}px) scale(${s})` }}>
        {children}
      </div>
    </div>
  );
};

export type Rect = { x: number; y: number; w: number; h: number };

/** Layout positions of elements in the camera's space (unaffected by its transform). */
export function useRects(ref: RefObject<HTMLElement | null>, selectors: Record<string, string>, dep?: unknown): Record<string, Rect> {
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const key = JSON.stringify(selectors);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const next: Record<string, Rect> = {};
    for (const [name, sel] of Object.entries(selectors)) {
      let el = root.querySelector(sel) as HTMLElement | null;
      if (!el) continue;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = 0;
      let y = 0;
      while (el && el !== root) {
        x += el.offsetLeft;
        y += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      next[name] = { x: x + w / 2, y: y + h / 2, w, h };
    }
    setRects((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dep]);
  return rects;
}

export const Cursor = ({ path, clicks = [] }: { path: Array<{ at: number; x: number; y: number }>; clicks?: number[] }) => {
  const frame = useCurrentFrame();
  const pos = cameraAt(path.map((p) => ({ ...p, zoom: 1 })), frame, 20);
  const pressed = clicks.some((c) => frame >= c && frame < c + 6);
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" style={{ position: "absolute", left: pos.x, top: pos.y, scale: pressed ? 0.86 : 1, transformOrigin: "4px 4px", zIndex: 30 }}>
      <path d="M5 3l14 9-6.5 1.4L16 20l-2.6 1.3-3.3-6.6L5 18z" fill="#000" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
};

/** Waits for the app's fonts so layout measurements and frames are stable. */
export function useFontsReady() {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all([
      document.fonts.load('400 20px "Mona Sans Variable"'),
      document.fonts.load('700 20px "Mona Sans Variable"'),
      document.fonts.load('400 20px "Monaspace Neon"'),
      document.fonts.load('500 20px "Monaspace Neon"'),
    ]).finally(() => continueRender(handle));
  }, [handle]);
}

export const Logo = ({ size = 72, color = "#fff" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 52 52">
    <circle cx="26" cy="26" r="25" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" />
    <g fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 22a12 12 0 0 1 21-5" />
      <path d="M37 11v7h-7" />
      <path d="M37 30a12 12 0 0 1-21 5" />
      <path d="M15 41v-7h7" />
    </g>
  </svg>
);

// ── Motion language: masked type, a floating app window ───────────────────────

/** Words rise out of a mask, one after another. */
export const Words = ({ text, at, stagger = 3, style }: { text: string; at: number; stagger?: number; style?: React.CSSProperties }) => {
  const frame = useCurrentFrame();
  return (
    <div style={style}>
      {text.split(" ").map((word, i) => {
        const p = rise(frame, at + i * stagger, 14);
        return (
          <span key={`${word}-${i}`} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: "0.12em", marginBottom: "-0.12em" }}>
            <span style={{ display: "inline-block", translate: `0 ${(1 - p) * 110}%`, whiteSpace: "pre" }}>{`${word} `}</span>
          </span>
        );
      })}
    </div>
  );
};

/** The app in a floating window on a dark stage, with a slow 3D drift. */
export const Stage = ({ children, tiltX = 0, tiltY = 0, scale = 0.94, y = -26 }: { children: ReactNode; tiltX?: number; tiltY?: number; scale?: number; y?: number }) => (
  <div style={{ position: "absolute", inset: 0, background: "#0b0b0b", perspective: 2600 }}>
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 22,
        overflow: "hidden",
        boxShadow: "0 40px 120px rgba(0,0,0,.6)",
        transform: `translateY(${y}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${scale})`,
      }}
    >
      {children}
    </div>
  </div>
);

export const count = (frame: number, start: number, to: number, dur = 24) => to * rise(frame, start, dur);
