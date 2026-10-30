import { AbsoluteFill, useCurrentFrame } from "remotion";
import { GREEN, Logo, MONO, RED, Reveal, SANS, lineAt, rise, typed } from "../common";
import { ISSUE, REPO, richProof } from "../app";
import run from "../data/rich.json";

const failure = (richProof.baseFailure ?? "").split("\n")[0];
const duration = `${Math.floor(run.wallSeconds / 60)} min ${run.wallSeconds % 60} s`;

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = lineAt("hook", 1);
  const l2 = lineAt("hook", 2);
  const l3 = lineAt("hook", 3);
  const lift = rise(f, l2, 22);
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS, justifyContent: "center", padding: "0 150px" }}>
      <div style={{ translate: `0 ${-150 * lift}px` }}>
        <div style={{ font: `500 34px ${SANS}`, color: "#a3a3a3", marginBottom: 18, opacity: rise(f, 2) }}>On the original code</div>
        <div style={{ font: `500 42px/1.3 ${MONO}`, color: "#ff8182", minHeight: 58 }}>
          <span style={{ color: RED, fontWeight: 700 }}>✗ </span>
          {typed(failure, f, 4, 0.7)}
        </div>
        <Reveal at={l1} style={{ marginTop: 56 }}>
          <div style={{ font: `500 34px ${SANS}`, color: "#a3a3a3", marginBottom: 18 }}>With the fix</div>
          <div style={{ font: `500 42px/1.3 ${MONO}`, color: "#7ee2a8" }}>
            <span style={{ color: GREEN, fontWeight: 700 }}>✓ </span>
            {richProof.newTests[0]} passes
          </div>
        </Reveal>
      </div>
      <Reveal at={l2} style={{ position: "absolute", left: 150, top: 650 }}>
        <div style={{ font: `600 46px ${SANS}` }}>
          {REPO} <span style={{ color: "#a3a3a3" }}>#{ISSUE.number}</span>
          <span style={{ marginLeft: 26, color: "#a3a3a3", fontWeight: 500 }}>★ 57.7k</span>
        </div>
      </Reveal>
      <Reveal at={l3} style={{ position: "absolute", left: 150, top: 745, display: "flex", alignItems: "center", gap: 28 }}>
        <Logo size={76} />
        <div style={{ font: `700 58px ${SANS}`, letterSpacing: -1 }}>ThePolisher</div>
        <div style={{ marginLeft: 26, padding: "12px 26px", borderRadius: 40, background: "#fff", color: "#000", font: `600 32px ${SANS}` }}>{duration}</div>
        <div style={{ padding: "12px 26px", borderRadius: 40, border: "1.5px solid #666", font: `600 32px ${SANS}` }}>${run.costUSD.toFixed(3)}</div>
      </Reveal>
    </AbsoluteFill>
  );
};
