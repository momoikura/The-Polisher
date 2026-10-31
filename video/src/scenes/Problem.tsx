import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { INK, Logo, MUTED, Reveal, SANS, Words, lineAt, rise } from "../common";

const QUESTIONS = ["Does it fix the bug?", "Did it break something else?", "Are the tests even real?"];
const COLS = 11;
const ROWS = 11;
const at = (i: number) => lineAt("problem", i);

/** An illustration of the flood: a wall of pull requests nobody can tell apart. */
const PrWall = ({ start }: { start: number }) => {
  const f = useCurrentFrame();
  const cells = Array.from({ length: COLS * ROWS }, (_, i) => i);
  return (
    <AbsoluteFill style={{ padding: 14, display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gridTemplateRows: `repeat(${ROWS}, 1fr)`, gap: 10, background: "#f6f6f6" }}>
      {cells.map((i) => {
        const appear = start + random(`pr-${i}`) * 44;
        const p = rise(f, appear, 10);
        return (
          <div key={i} style={{ opacity: p, translate: `0 ${(1 - p) * -24}px`, background: "#fff", border: "1.5px solid #d4d4d4", borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <div style={{ height: 7, width: `${50 + random(`w-${i}`) * 45}%`, borderRadius: 4, background: "#bbb" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ font: `600 15px ${SANS}`, color: "#767676" }}>AI PR</span>
              <span style={{ font: `700 22px ${SANS}`, color: INK }}>?</span>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const flood = rise(f, at(5) - 3, 12);
  const reveal = rise(f, at(6) - 2, 16);
  return (
    <AbsoluteFill style={{ background: "#fff", color: INK, fontFamily: SANS, padding: "110px 150px" }}>
      <Words text="AI can write a fix in seconds." at={at(0) + 26} style={{ font: `700 92px/1.08 ${SANS}`, letterSpacing: -2.5 }} />
      <Words text="Then someone has to check it." at={at(1) + 6} style={{ font: `500 54px ${SANS}`, color: MUTED, marginTop: 22 }} />
      <div style={{ marginTop: 74 }}>
        {QUESTIONS.map((q, i) => {
          const start = at(i + 2);
          return (
            <Reveal key={q} at={start} style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 26 }}>
              <span style={{ width: 52, height: 52, borderRadius: 10, border: `3px solid ${INK}`, display: "grid", placeItems: "center", font: `700 34px ${SANS}`, color: MUTED }}>?</span>
              <span style={{ font: `600 62px ${SANS}`, letterSpacing: -1 }}>{q}</span>
            </Reveal>
          );
        })}
      </div>

      {flood > 0 && (
        <AbsoluteFill style={{ opacity: flood }}>
          <PrWall start={at(5)} />
          <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ background: "#000", color: "#fff", padding: "34px 56px", borderRadius: 20, opacity: rise(f, at(5) + 34), scale: 0.97 + 0.03 * rise(f, at(5) + 34) }}>
              <div style={{ font: `700 82px/1.05 ${SANS}`, letterSpacing: -2.5, textAlign: "center" }}>Which ones work?</div>
            </div>
          </AbsoluteFill>
        </AbsoluteFill>
      )}

      {/* Black floods out of the middle, and the name rises out of it. */}
      {reveal > 0 && (
        <AbsoluteFill style={{ background: "#000", clipPath: `circle(${reveal * 120}% at 50% 48%)`, color: "#fff", justifyContent: "center", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
            <div style={{ scale: interpolate(rise(f, at(6) + 4, 16), [0, 1], [0.5, 1]), opacity: rise(f, at(6) + 4) }}>
              <Logo size={130} />
            </div>
            <div>
              <Words text="ThePolisher" at={at(6) + 8} style={{ font: `700 116px ${SANS}`, letterSpacing: -3.5 }} />
              <Words text="A verifiable agent on Meta's Muse Spark" at={at(7)} stagger={2} style={{ font: `500 44px ${SANS}`, color: "#a3a3a3" }} />
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
