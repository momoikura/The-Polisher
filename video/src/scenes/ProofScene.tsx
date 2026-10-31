import { useRef } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Camera, SANS, Stage, Words, cameraAt, lineAt, rise, useRects } from "../common";
import { PrPage, REPO, TopBar, finalRich } from "../app";
import beats from "../beats.json";

const PASS = "#7ee2a8";

export const ProofScene: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const rects = useRects(ref, { card: ".proof-card", s1: ".proof-steps li:nth-child(1)", s3: ".proof-steps li:nth-child(3)" });
  const c = rects.card ?? { x: 540, y: 600 };
  const s1 = rects.s1 ?? c;
  const s3 = rects.s3 ?? c;
  const l1 = lineAt("proof", 1);
  const l2 = lineAt("proof", 2);
  const l3 = lineAt("proof", 3);
  const passAt = l2 + Math.round(beats.proofPass * 30);
  const proofAt = l3 + Math.round(beats.proofWord * 30);
  const cam = cameraAt([{ at: l1 - 6, x: c.x + 60, y: s1.y, zoom: 1.04 }, { at: l1 + 6, x: c.x, y: s3.y - 30, zoom: 1.28 }, { at: l2, x: c.x, y: s1.y + 90, zoom: 1.28 }], f, 30);
  // The steps light up in the order the narration says them.
  const lit = [f >= l2, f >= passAt, f < l2 || f >= passAt];
  const open = rise(f, lineAt("proof", 0) + 42, 10);
  const close = rise(f, l3 - 4, 14);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Stage>
        <Camera x={cam.x} y={cam.y} zoom={cam.zoom} rootRef={ref}>
          <style>{lit.map((on, i) => `.proof-steps li:nth-child(${i + 1}){opacity:${on ? 1 : 0.25}}`).join("")}</style>
          <TopBar repo={REPO} />
          <PrPage view={finalRich} showProof />
        </Camera>
      </Stage>
      {/* Opens on black, for the line, and closes back onto black for the verdict. */}
      {open < 1 && (
        <AbsoluteFill style={{ background: "#000", clipPath: `circle(${(1 - open) * 120}% at 50% 48%)`, justifyContent: "center", alignItems: "center", color: "#fff" }}>
          <Words text="The moment of truth." at={lineAt("proof", 0) + 8} style={{ font: `700 120px ${SANS}`, letterSpacing: -4 }} />
        </AbsoluteFill>
      )}
      {close > 0 && (
        <AbsoluteFill style={{ background: "#000", clipPath: `circle(${close * 120}% at 50% 48%)`, justifyContent: "center", alignItems: "center", color: "#fff", textAlign: "center" }}>
          <div>
            <Words text="Not a model's opinion." at={l3 + 2} style={{ font: `600 66px ${SANS}`, color: "#a3a3a3", letterSpacing: -1.5, marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 30, alignItems: "center", justifyContent: "center", opacity: f >= proofAt ? 1 : 0, scale: 1.06 - 0.06 * rise(f, proofAt, 12) }}>
              <div style={{ width: 118, height: 118, borderRadius: 60, background: PASS, color: "#000", display: "grid", placeItems: "center", font: `700 72px ${SANS}` }}>✓</div>
              <div style={{ font: `700 170px ${SANS}`, letterSpacing: -6 }}>Proof.</div>
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
