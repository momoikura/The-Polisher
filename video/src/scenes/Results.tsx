import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { INK, MONO, MUTED, Reveal, SANS, lineAt, rise } from "../common";

const PROJECTS = ["Rich", "jsonschema", "sqlglot", "urllib3", "Pygments", "astroid", "pyparsing", "more-itertools", "humanize"];
const MISSES = ["pyparsing#693", "astroid#3255", "pygments#3247"];
const FULL = 1040;
const at = (i: number) => lineAt("results", i);

const Bar = ({ start, n, label, color, text }: { start: number; n: number; label: string; color: string; text: string }) => {
  const f = useCurrentFrame();
  const p = rise(f, start, 36);
  return (
    <div style={{ opacity: rise(f, start - 2, 8), marginBottom: 24 }}>
      <div style={{ font: `500 34px ${SANS}`, color: MUTED, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ height: 88, width: (FULL * n * p) / 17, background: color, borderRadius: 8 }} />
        <div style={{ font: `700 72px ${SANS}`, color: text, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(interpolate(p, [0, 1], [0, n]))}
          <span style={{ fontWeight: 500, fontSize: 38, color: MUTED }}> of 17 proven</span>
        </div>
      </div>
    </div>
  );
};

const Stat = ({ big, small }: { big: string; small: string }) => (
  <div>
    <div style={{ font: `700 72px ${SANS}`, letterSpacing: -1 }}>{big}</div>
    <div style={{ font: `500 30px ${SANS}`, color: MUTED }}>{small}</div>
  </div>
);

export const Results: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#fff", color: INK, fontFamily: SANS, padding: "60px 110px" }}>
      <div style={{ font: `700 64px ${SANS}`, letterSpacing: -1.5 }}>17 real open issues. 9 projects we don't control.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 20 }}>
        {PROJECTS.map((p, i) => (
          <Reveal key={p} at={4 + i * 5} y={10} style={{ padding: "8px 20px", borderRadius: 30, border: "1.5px solid #bbb", font: `500 27px ${MONO}` }}>
            {p}
          </Reveal>
        ))}
      </div>
      <div style={{ marginTop: 44 }}>
        <Bar start={at(1)} n={14} label="ThePolisher" color="#000" text={INK} />
        <Bar start={at(2)} n={7} label="Single prompt, same model" color="#c4c4c4" text={MUTED} />
      </div>
      <div style={{ position: "absolute", left: 110, right: 110, top: 730, display: "flex", gap: 80 }}>
        <Reveal at={at(3)}>
          <Stat big={`$${interpolate(rise(f, at(3), 24), [0, 1], [0, 0.66]).toFixed(2)}`} small="for all 17" />
        </Reveal>
        <Reveal at={at(4)} style={{ flex: 1 }}>
          <div style={{ font: `700 38px ${SANS}`, marginBottom: 14 }}>Not proven, and it says so</div>
          <div style={{ display: "flex", gap: 12, opacity: rise(f, at(5)) }}>
            {MISSES.map((m) => (
              <span key={m} style={{ padding: "6px 14px", borderRadius: 8, background: "#f6f6f6", border: "1.5px solid #d4d4d4", font: `500 24px ${MONO}` }}>
                ✗ {m}
              </span>
            ))}
          </div>
        </Reveal>
        <Reveal at={at(6)}>
          <Stat big="5.5 min" small="median, latest full run" />
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
