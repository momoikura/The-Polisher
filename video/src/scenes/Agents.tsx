import { useRef } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Camera, GREEN, INK, MONO, RED, SANS, cameraAt, lineAt, rise, useRects } from "../common";
import { PrPage, REPO, TopBar, eventIndex, richEvents, viewFrom } from "../app";
import { Clock } from "./Paste";

const START = eventIndex("candidates") + 4;
const LAST = richEvents.length;

const Rev = ({ x, y, label, color, verdict }: { x: number; y: number; label: string; color: string; verdict: string }) => (
  <div style={{ position: "absolute", left: x, top: y, width: 470, padding: "22px 26px", borderRadius: 14, background: "#fff", border: `3px solid ${verdict ? color : INK}` }}>
    <div style={{ font: `500 22px ${MONO}`, color: "#767676" }}>a revision</div>
    <div style={{ font: `600 34px ${SANS}` }}>{label}</div>
    {verdict && <div style={{ font: `700 34px ${SANS}`, color, marginTop: 6 }}>{verdict}</div>}
  </div>
);

/** An illustration of the gate's rule, not footage. */
const Gate = ({ start }: { start: number }) => {
  const f = useCurrentFrame();
  const reject = lineAt("agents", 6);
  const kept = rise(f, start + 8, 30);
  const out = rise(f, reject, 30);
  return (
    <AbsoluteFill style={{ background: "#fff", opacity: rise(f, start, 12), justifyContent: "center", alignItems: "center", fontFamily: SANS, color: INK }}>
      <div style={{ position: "relative", width: 1500, height: 560, top: -30 }}>
        <div style={{ position: "absolute", left: 620, top: 60, width: 260, height: 420, borderRadius: 18, background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 60px ${SANS}`, zIndex: 3 }}>Gate</div>
        <Rev y={80} x={interpolate(kept, [0, 1], [90, 1030])} label="Fixes a failing check" color={GREEN} verdict={kept > 0.85 ? "Kept" : ""} />
        <Rev y={300} x={interpolate(out, [0, 1], [90, 130])} label="Breaks a passing test" color={RED} verdict={out > 0.5 ? "Thrown out" : ""} />
      </div>
    </AbsoluteFill>
  );
};

export const Agents: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const gateAt = lineAt("agents", 5);
  const n = Math.round(interpolate(f, [0, gateAt - 10], [START, LAST], { extrapolateRight: "clamp" }));
  const rects = useRects(ref, { c0: ".agent:nth-of-type(1)", c1: ".agent:nth-of-type(2)", c2: ".agent:nth-of-type(3)", c3: ".agent:nth-of-type(4)" }, n);
  const on = (name: string, at: number): { at: number; x: number; y: number; zoom: number } => {
    const r = rects[name] ?? { x: 1150, y: 600 };
    return { at, x: 720, y: r.y + 30, zoom: 1.12 };
  };
  const cam = cameraAt([{ at: 0, x: 860, y: 600, zoom: 1.05 }, on("c0", lineAt("agents", 1)), on("c1", lineAt("agents", 2)), on("c2", lineAt("agents", 3)), on("c3", lineAt("agents", 4))], f);
  return (
    <>
      <Camera x={cam.x} y={cam.y} zoom={cam.zoom} rootRef={ref}>
        <TopBar repo={REPO} />
        <PrPage view={viewFrom(richEvents, n)} />
      </Camera>
      <Clock n={n} />
      {f >= gateAt - 2 && <Gate start={gateAt} />}
    </>
  );
};
