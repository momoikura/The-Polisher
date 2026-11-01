import { AbsoluteFill, useCurrentFrame } from "remotion";
import { MONO, Reveal, SANS, Words, lineAt, rise, typed } from "../common";

// Muse Wonder's real tests, from its run on Textualize/rich#4237 (benchmarks/results/challenge-2026-11-01.jsonl).
const TEST = `def test_negative_int_index_boundary_spans():
    text = Text('abcd', spans=[Span(1, 3, 'bold')])
    assert text[-1] == Text('d')
    assert text[-1].spans == []`;
const IDEAS = ["Half-open span boundaries at negative indices", "Out-of-range and empty IndexError not masked", "Overlapping tail spans rebased and preserved"];
const at = (i: number) => lineAt("wonder", i);

export const Wonder: React.FC = () => {
  const f = useCurrentFrame();
  const intro = rise(f, at(1) - 8, 12);
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - intro, padding: "0 140px", textAlign: "center" }}>
        <Words text="A proof is only as good as its tests." at={at(0) + 2} stagger={2} style={{ font: `700 104px/1.1 ${SANS}`, letterSpacing: -3 }} />
      </AbsoluteFill>
      {intro > 0 && (
        <div style={{ position: "absolute", inset: "70px 110px", opacity: intro }}>
          <Words text="Muse Wonder tries to break it." at={at(1)} stagger={2} style={{ font: `700 84px ${SANS}`, letterSpacing: -2.5 }} />
          <Reveal at={at(1) + 30} style={{ font: `500 36px ${SANS}`, color: "#a3a3a3", marginTop: 12 }}>
            Meta's stronger model. It didn't write this fix.
          </Reveal>
          <div style={{ display: "flex", gap: 40, marginTop: 56 }}>
            <div style={{ flex: "1.5", padding: 36, borderRadius: 18, background: "#111", border: "1.5px solid #2c2c2c", minHeight: 400, opacity: rise(f, at(2) - 4) }}>
              <div style={{ font: `600 26px ${MONO}`, color: "#8a8a8a", marginBottom: 24 }}>tests/test_thepolisher_challenge.py</div>
              <div style={{ font: `500 27px/1.7 ${MONO}`, whiteSpace: "pre-wrap" }}>{typed(TEST, f, at(2) + 2, 2)}</div>
            </div>
            <div style={{ flex: 1 }}>
              {IDEAS.map((idea, i) => (
                <Reveal key={idea} at={at(2) + 24 + i * 16} style={{ font: `500 32px/1.3 ${SANS}`, padding: "20px 0", borderBottom: "1.5px solid #2c2c2c", color: "#e5e5e5" }}>
                  {idea}
                </Reveal>
              ))}
              <div style={{ marginTop: 34, font: `700 60px ${SANS}`, letterSpacing: -1.5, color: "#3fb950", opacity: rise(f, at(2) + 70) }}>3 of 3 pass</div>
              <div style={{ font: `500 26px ${SANS}`, color: "#a3a3a3", opacity: rise(f, at(2) + 76), marginTop: 6 }}>on this run of Rich#4237</div>
            </div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
