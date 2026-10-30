import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { INK, Logo, MUTED, Reveal, SANS, lineAt, rise } from "../common";

const QUESTIONS = ["Does it fix the bug?", "Did it break something else?", "Are the tests real?", "Is the pull request description true?"];

export const Problem: React.FC = () => {
  const f = useCurrentFrame();
  const flip = rise(f, lineAt("problem", 7) - 4, 14);
  return (
    <AbsoluteFill style={{ background: "#fff", color: INK, fontFamily: SANS, padding: "90px 150px" }}>
      <div style={{ opacity: 1 - flip }}>
        <div style={{ font: `700 92px/1.08 ${SANS}`, letterSpacing: -2 }}>AI can write a fix in seconds.</div>
        <Reveal at={lineAt("problem", 1)}>
          <div style={{ font: `500 54px ${SANS}`, color: MUTED, marginTop: 22 }}>Then someone has to check it.</div>
        </Reveal>
        <div style={{ marginTop: 56 }}>
          {QUESTIONS.map((q, i) => (
            <Reveal key={q} at={lineAt("problem", i + 2)} style={{ display: "flex", alignItems: "center", gap: 28, marginBottom: 22 }}>
              <span style={{ width: 44, height: 44, borderRadius: 8, border: `3px solid ${INK}` }} />
              <span style={{ font: `500 56px ${SANS}`, letterSpacing: -0.5 }}>{q}</span>
            </Reveal>
          ))}
        </div>
        <Reveal at={lineAt("problem", 6)} style={{ font: `700 56px ${SANS}`, marginTop: 30 }}>
          That checking is the slow part.
        </Reveal>
      </div>
      <AbsoluteFill style={{ background: "#000", opacity: flip, justifyContent: "center", alignItems: "center", color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34, scale: interpolate(flip, [0, 1], [0.97, 1]) }}>
          <Logo size={130} />
          <div>
            <div style={{ font: `700 112px ${SANS}`, letterSpacing: -3 }}>ThePolisher</div>
            <div style={{ font: `500 46px ${SANS}`, color: "#a3a3a3" }}>with Meta's Muse Spark</div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
