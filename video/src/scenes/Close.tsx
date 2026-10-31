import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Logo, MONO, Reveal, SANS, Words, count, lineAt, rise } from "../common";
import meta from "../data/meta.json";

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = lineAt("close", 1);
  const l2 = lineAt("close", 2);
  const flip = rise(f, l1 - 6, 12);
  const stats = [
    { big: "Oct 27 to Nov 4", small: "built during the hackathon" },
    { big: `${Math.round(count(f, 20, meta.commits, 34))}+`, small: "commits, all public" },
    { big: String(Math.round(count(f, 32, meta.tests, 34))), small: "automated tests" },
  ];
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS, justifyContent: "center", padding: "0 150px" }}>
      <div style={{ opacity: 1 - flip, display: "flex", gap: 110, position: "absolute", left: 150, top: 400 }}>
        {stats.map(({ big, small }, i) => (
          <Reveal key={small} at={8 + i * 12}>
            <div style={{ font: `700 72px ${SANS}`, letterSpacing: -1, fontVariantNumeric: "tabular-nums" }}>{big}</div>
            <div style={{ font: `500 34px ${SANS}`, color: "#a3a3a3" }}>{small}</div>
          </Reveal>
        ))}
      </div>
      <div style={{ opacity: flip }}>
        <Words text="AI writes fixes." at={l1} style={{ font: `700 132px/1.08 ${SANS}`, letterSpacing: -4, color: "#8a8a8a" }} />
        <Words text="ThePolisher proves them." at={l2} style={{ font: `700 132px/1.08 ${SANS}`, letterSpacing: -4 }} />
        <Reveal at={l2 + 24} style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 56 }}>
          <Logo size={70} />
          <div style={{ font: `500 38px ${MONO}` }}>thepolisher.pages.dev</div>
          <div style={{ font: `500 32px ${MONO}`, color: "#a3a3a3", marginLeft: 20 }}>github.com/momoikura/The-Polisher</div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
