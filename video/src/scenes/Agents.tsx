import { useRef } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Camera, GREEN, INK, MONO, RED, SANS, Stage, cameraAt, lineAt, rise, useRects } from "../common";
import { PrPage, REPO, TopBar, eventIndex, richEvents, viewFrom } from "../app";
import { Clock } from "./Paste";

const START = eventIndex("candidates") + 4;
const LAST = richEvents.length;

const Rev = ({ style, label, color, verdict }: { style: React.CSSProperties; label: string; color: string; verdict: string }) => (
  <div style={{ position: "absolute", width: 470, padding: "22px 26px", borderRadius: 14, background: "#fff", border: `3px solid ${verdict ? color : INK}`, ...style }}>
    <div style={{ font: `500 22px ${MONO}`, color: "#767676" }}>a revision</div>
    <div style={{ font: `600 34px ${SANS}` }}>{label}</div>
    <div style={{ font: `700 34px ${SANS}`, color, marginTop: 6, minHeight: 42 }}>{verdict}</div>
  </div>
);

/** An illustration of the gate's rule, not footage. */
const Gate = ({ start }: { start: number }) => {
  const f = useCurrentFrame();
  const reject = lineAt("agents", 6);
  const kept = rise(f, start + 6, 32);
  const hit = rise(f, reject, 8);
  const fall = rise(f, reject + 12, 34);
  const reveal = rise(f, start - 2, 14);
  return (
    <AbsoluteFill style={{ background: "#fff", clipPath: `circle(${reveal * 120}% at 76% 40%)`, justifyContent: "center", alignItems: "center", fontFamily: SANS, color: INK, overflow: "hidden" }}>
      <div style={{ position: "relative", width: 1500, height: 560, top: -40 }}>
        <div style={{ position: "absolute", left: 620, top: 40, width: 260, height: 460, borderRadius: 18, background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", font: `700 60px ${SANS}`, zIndex: 3, scale: 1 + 0.02 * (1 - rise(f, reject + 6, 10)) * (f >= reject + 6 ? 1 : 0) }}>Gate</div>
        <Rev style={{ top: 60, left: interpolate(kept, [0, 1], [90, 1030]), zIndex: 2 }} label="Fixes a failing check" color={GREEN} verdict={kept > 0.9 ? "Kept" : ""} />
        {f >= reject - 8 && (
          <Rev
            style={{ top: 280 + 520 * fall * fall, left: interpolate(hit, [0, 1], [-60, 150]) - 60 * fall, rotate: `${-24 * fall}deg`, zIndex: 1, opacity: 1 - rise(f, reject + 34, 10) * 0.2 }}
            label="Breaks a passing test"
            color={RED}
            verdict={hit > 0.8 ? "Thrown out" : ""}
          />
        )}
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
  const on = (name: string, at: number) => ({ at, x: 720, y: (rects[name]?.y ?? 600) + 30, zoom: 1.05 });
  const cam = cameraAt([{ at: 0, x: 720, y: 560, zoom: 1.05 }, on("c0", lineAt("agents", 1)), on("c1", lineAt("agents", 2)), on("c2", lineAt("agents", 3)), on("c3", lineAt("agents", 4))], f);
  const active = [4, 3, 2, 1].find((i) => f >= lineAt("agents", i)) ?? 0;
  const glow = active ? rise(f, lineAt("agents", active), 8) : 0;
  return (
    <>
      <Stage>
        <Camera x={cam.x} y={cam.y} zoom={cam.zoom} rootRef={ref}>
          {active > 0 && <style>{`.agent{opacity:.42}.agent:nth-of-type(${active}){opacity:1;outline:3px solid rgba(0,0,0,${glow});outline-offset:6px;border-radius:12px}`}</style>}
          <TopBar repo={REPO} />
          <PrPage view={viewFrom(richEvents, n)} />
        </Camera>
      </Stage>
      {f < gateAt && <Clock n={n} />}
      {f >= gateAt - 2 && <Gate start={gateAt} />}
    </>
  );
};
