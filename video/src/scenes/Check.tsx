import { AbsoluteFill, useCurrentFrame } from "remotion";
import { GREEN, INK, MONO, MUTED, RED, Reveal, SANS, Words, lineAt, rise, typed } from "../common";

const PR_URL = "github.com/Textualize/rich/pull/4076";
const at = (i: number) => lineAt("check", i);

/** Verified in the sandbox on each commit: benchmarks/results/pr-check-2026-11-02.md. */
const ROWS: Array<{ name: string; result: string; ok: boolean; from: number }> = [
  { name: "Before the change", result: "['foo', 'bar', 'baz']", ok: true, from: 0 },
  { name: "With the change", result: "['', '', 'baz']", ok: false, from: 24 },
];

export const Check: React.FC = () => {
  const f = useCurrentFrame();
  const showResult = rise(f, at(3) - 6, 12);
  return (
    <AbsoluteFill style={{ background: "#fff", color: INK, fontFamily: SANS }}>
      <div style={{ position: "absolute", inset: "64px 110px" }}>
        <Words text="Check anyone's pull request." at={at(0) + 2} stagger={2} style={{ font: `700 84px ${SANS}`, letterSpacing: -2.5 }} />
        <div style={{ marginTop: 34, padding: "22px 28px", borderRadius: 14, border: "2px solid #d4d4d4", font: `500 36px ${MONO}`, opacity: rise(f, at(1) - 4), minHeight: 44 }}>
          {typed(PR_URL, f, at(1) + 2, 0.8)}
        </div>
        <Reveal at={at(2)} style={{ font: `500 34px ${SANS}`, color: MUTED, marginTop: 26 }}>
          Muse Wonder's test on this merged Rich change:
        </Reveal>
        <div style={{ opacity: showResult, marginTop: 22 }}>
          <div style={{ font: `500 30px ${MONO}`, marginBottom: 20 }}>decode("foo\r\nbar\r\nbaz")</div>
          {ROWS.map((r) => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 28, padding: "16px 0", borderTop: "1.5px solid #e5e5e5", opacity: rise(f, at(3) + r.from) }}>
              <span style={{ font: `700 40px ${SANS}`, width: 44, color: r.ok ? GREEN : RED }}>{r.ok ? "✓" : "✗"}</span>
              <span style={{ font: `600 36px ${SANS}`, width: 420 }}>{r.name}</span>
              <span style={{ font: `500 34px ${MONO}`, color: r.ok ? INK : RED }}>{r.result}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 70, marginTop: 34 }}>
          <Reveal at={at(4)} style={{ font: `700 46px/1.2 ${SANS}`, letterSpacing: -1 }}>
            A real bug. Still open.
            <div style={{ font: `500 28px ${MONO}`, color: MUTED, marginTop: 8, letterSpacing: 0 }}>Textualize/rich#4090</div>
          </Reveal>
          <Reveal at={at(5)} style={{ font: `700 46px/1.2 ${SANS}`, letterSpacing: -1 }}>
            Nothing gets posted.
            <div style={{ font: `500 28px ${SANS}`, color: MUTED, marginTop: 8, letterSpacing: 0 }}>The maintainer decides.</div>
          </Reveal>
        </div>
      </div>
    </AbsoluteFill>
  );
};
