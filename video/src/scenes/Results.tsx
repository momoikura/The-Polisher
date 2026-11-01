import { AbsoluteFill, useCurrentFrame } from "remotion";
import { INK, MONO, MUTED, RED, Reveal, SANS, Words, count, lineAt, rise } from "../common";

const PROJECTS = ["Rich", "jsonschema", "sqlglot", "urllib3", "Pygments", "astroid", "pyparsing", "more-itertools", "humanize"];
const MISSES = ["astroid#3255", "jsonschema#1588", "pyparsing#693"];
const ISSUES = 16;
const at = (i: number) => lineAt("results", i);

/** One row of 16 cells, one per issue, filling up one at a time. */
const Board = ({ label, proven, start, ink, isOurs = false }: { label: string; proven: number; start: number; ink: string; isOurs?: boolean }) => {
  const f = useCurrentFrame();
  const showMisses = isOurs && f >= at(5);
  return (
    <div style={{ marginBottom: 30, opacity: rise(f, start - 6, 8) }}>
      <div style={{ font: `600 34px ${SANS}`, color: isOurs ? INK : MUTED, marginBottom: 12 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {Array.from({ length: ISSUES }, (_, i) => {
            const p = i < proven ? rise(f, start + 4 + i * 2, 7) : 0;
            const isMiss = showMisses && i >= proven;
            return <div key={i} style={{ width: 72, height: 72, borderRadius: 10, border: `2px solid ${isMiss ? RED : "#d4d4d4"}`, background: p === 0 ? "#fff" : ink, display: "grid", placeItems: "center", color: RED, font: `700 34px ${SANS}`, scale: 0.9 + 0.1 * Math.max(p, 1 - rise(f, start, 4)) }}>{isMiss ? "✗" : ""}</div>;
          })}
        </div>
        <div style={{ font: `700 92px ${SANS}`, letterSpacing: -3, color: isOurs ? INK : MUTED, fontVariantNumeric: "tabular-nums", minWidth: 110 }}>{Math.round(count(f, start + 4, proven, proven * 2 + 6))}</div>
      </div>
    </div>
  );
};

export const Results: React.FC = () => {
  const f = useCurrentFrame();
  const intro = rise(f, at(1) - 8, 12);
  return (
    <AbsoluteFill style={{ background: "#fff", color: INK, fontFamily: SANS }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - intro, padding: "0 160px", textAlign: "center" }}>
        <Words text="So does it hold up in the real world?" at={at(0) + 2} stagger={2} style={{ font: `700 110px/1.05 ${SANS}`, letterSpacing: -4 }} />
      </AbsoluteFill>
      {intro > 0 && (
        <div style={{ position: "absolute", left: 110, right: 110, top: 54, opacity: intro }}>
          <Words text="16 real open issues. 9 projects we don't control." at={at(1)} stagger={2} style={{ font: `700 62px ${SANS}`, letterSpacing: -1.5 }} />
          <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
            {PROJECTS.map((p, i) => (
              <Reveal key={p} at={at(1) + 12 + i * 4} y={10} style={{ padding: "7px 16px", borderRadius: 30, border: "1.5px solid #bbb", font: `500 24px ${MONO}`, whiteSpace: "nowrap" }}>
                {p}
              </Reveal>
            ))}
          </div>
          <div style={{ marginTop: 40 }}>
            {f >= at(2) - 8 && <Board label="First draft, same model" proven={6} start={at(2)} ink="#bdbdbd" />}
            {f >= at(3) - 8 && <Board label="ThePolisher" proven={13} start={at(3)} ink="#000" isOurs />}
          </div>
          <div style={{ display: "flex", gap: 80, alignItems: "flex-start", marginTop: 6 }}>
            <Reveal at={at(4)} style={{ flex: "none" }}>
              <div style={{ font: `700 66px ${SANS}`, letterSpacing: -1.5, fontVariantNumeric: "tabular-nums" }}>2× · ${count(f, at(4) + 6, 0.48).toFixed(2)}</div>
              <div style={{ font: `500 30px ${SANS}`, color: MUTED }}>as many proven, total cost</div>
            </Reveal>
            <Reveal at={at(5)}>
              <div style={{ font: `700 38px ${SANS}`, marginBottom: 12 }}>Not proven, and it says so</div>
              <div style={{ display: "flex", gap: 12, opacity: rise(f, at(6)) }}>
                {MISSES.map((m) => (
                  <span key={m} style={{ padding: "6px 14px", borderRadius: 8, background: "#f6f6f6", border: "1.5px solid #d4d4d4", font: `500 26px ${MONO}` }}>
                    {m}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
