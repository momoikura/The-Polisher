import { useRef } from "react";
import { useCurrentFrame } from "remotion";
import { Camera, cameraAt, lineAt, useRects } from "../common";
import { PrPage, REPO, TopBar, finalRich } from "../app";

export const ProofScene: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const rects = useRects(ref, { card: ".proof-card", s1: ".proof-steps li:nth-child(1)", s3: ".proof-steps li:nth-child(3)" });
  const c = rects.card ?? { x: 540, y: 600 };
  const s1 = rects.s1 ?? c;
  const s3 = rects.s3 ?? c;
  const l1 = lineAt("proof", 1);
  const passAt = l1 + 100;
  const cam = cameraAt([{ at: 0, x: c.x + 100, y: s1.y, zoom: 1.05 }, { at: 12, x: c.x, y: s3.y - 30, zoom: 1.28 }, { at: l1, x: c.x, y: s1.y + 90, zoom: 1.28 }], f, 30);
  // The steps light up in the order the narration says them.
  const lit = [f >= l1, f >= passAt, f < l1 || f >= passAt];
  return (
    <Camera x={cam.x} y={cam.y} zoom={cam.zoom} rootRef={ref}>
      <style>{lit.map((on, i) => `.proof-steps li:nth-child(${i + 1}){opacity:${on ? 1 : 0.25}}`).join("")}</style>
      <TopBar repo={REPO} />
      <PrPage view={finalRich} showProof />
    </Camera>
  );
};
