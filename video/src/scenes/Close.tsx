import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Logo, MONO, Reveal, SANS, lineAt, rise } from "../common";
import meta from "../data/meta.json";

const STATS = [
  ["Oct 27 to Nov 4", "built during the hackathon"],
  [`${meta.commits}+`, "commits, all public"],
  [String(meta.tests), "automated tests"],
];

export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = lineAt("close", 1);
  const l2 = lineAt("close", 2);
  const flip = rise(f, l1 - 6, 14);
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS, justifyContent: "center", padding: "0 150px" }}>
      <div style={{ opacity: 1 - flip, display: "flex", gap: 110, position: "absolute", left: 150, top: 400 }}>
        {STATS.map(([big, small], i) => (
          <Reveal key={big} at={8 + i * 12}>
            <div style={{ font: `700 72px ${SANS}`, letterSpacing: -1 }}>{big}</div>
            <div style={{ font: `500 34px ${SANS}`, color: "#a3a3a3" }}>{small}</div>
          </Reveal>
        ))}
      </div>
      <div style={{ opacity: flip }}>
        <div style={{ font: `700 124px/1.05 ${SANS}`, letterSpacing: -3, color: "#a3a3a3" }}>AI writes fixes.</div>
        <Reveal at={l2}>
          <div style={{ font: `700 124px/1.05 ${SANS}`, letterSpacing: -3 }}>ThePolisher proves them.</div>
        </Reveal>
        <Reveal at={l2 + 18} style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 60 }}>
          <Logo size={70} />
          <div style={{ font: `500 38px ${MONO}` }}>thepolisher.pages.dev</div>
          <div style={{ font: `500 34px ${MONO}`, color: "#a3a3a3", marginLeft: 20 }}>github.com/momoikura/The-Polisher</div>
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
