import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Logo, MONO, Reveal, SANS, Words, count, lineAt, rise, typed } from "../common";
import { ISSUE, REPO, richProof } from "../app";
import run from "../data/rich.json";

const failure = (richProof.baseFailure ?? "").split("\n")[0];
const duration = `${Math.floor(run.wallSeconds / 60)} min ${run.wallSeconds % 60} s`;
const PASS = "#7ee2a8";
const FAIL = "#ff8182";

const Verdict = ({ at, ok, label, children }: { at: number; ok: boolean; label: string; children: React.ReactNode }) => {
  const f = useCurrentFrame();
  const p = rise(f, at, 12);
  return (
    <div style={{ display: "flex", gap: 34, alignItems: "flex-start", opacity: p, translate: `0 ${(1 - p) * 18}px`, marginBottom: 54 }}>
      <div style={{ flex: "none", width: 84, height: 84, borderRadius: 42, display: "grid", placeItems: "center", background: ok ? PASS : FAIL, color: "#000", font: `700 50px ${SANS}`, scale: 0.7 + 0.3 * rise(f, at, 10) }}>{ok ? "✓" : "✗"}</div>
      <div>
        <div style={{ font: `500 32px ${SANS}`, color: "#a3a3a3", marginBottom: 8 }}>{label}</div>
        <div style={{ font: `500 38px/1.3 ${MONO}`, color: ok ? PASS : FAIL }}>{children}</div>
      </div>
    </div>
  );
};

export const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = lineAt("hook", 1);
  const l2 = lineAt("hook", 2);
  const l3 = lineAt("hook", 3);
  const l4 = lineAt("hook", 4);
  const lift = rise(f, l3, 24);
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - rise(f, l1 - 6, 10) }}>
        <Words text="Watch this test." at={lineAt("hook", 0)} style={{ font: `700 150px ${SANS}`, letterSpacing: -5 }} />
      </AbsoluteFill>
      {f >= l1 - 2 && (
        <div style={{ position: "absolute", left: 150, right: 150, top: 300 - 170 * lift }}>
          <Verdict at={l1} ok={false} label="On the original code">
            {typed(failure, f, l1 + 2, 0.5)}
          </Verdict>
          <Verdict at={l2} ok label="With the fix">
            {richProof.newTests[0]} passes
          </Verdict>
        </div>
      )}
      {f >= l3 - 2 && (
        <div style={{ position: "absolute", left: 150, top: 600 }}>
          <Words text={`${REPO} #${ISSUE.number}`} at={l3} stagger={4} style={{ font: `700 66px ${SANS}`, letterSpacing: -1.5 }} />
          <div style={{ marginTop: 10, font: `500 42px ${SANS}`, color: "#a3a3a3", opacity: rise(f, l3 + 10), fontVariantNumeric: "tabular-nums" }}>★ {count(f, l3 + 10, 57.7, 30).toFixed(1)}k stars</div>
        </div>
      )}
      <Reveal at={l4} style={{ position: "absolute", left: 150, top: 800, display: "flex", alignItems: "center", gap: 28 }}>
        <Logo size={76} />
        <div style={{ font: `700 56px ${SANS}`, letterSpacing: -1 }}>ThePolisher</div>
        <div style={{ marginLeft: 26, padding: "12px 26px", borderRadius: 40, background: "#fff", color: "#000", font: `600 32px ${SANS}` }}>{duration}</div>
        <div style={{ padding: "12px 26px", borderRadius: 40, border: "1.5px solid #666", font: `600 32px ${SANS}` }}>${run.costUSD.toFixed(3)}</div>
      </Reveal>
    </AbsoluteFill>
  );
};
