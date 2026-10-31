import { AbsoluteFill } from "remotion";
import { Logo, MONO, SANS, useFontsReady } from "./common";

const PASS = "#7ee2a8";
const FAIL = "#ff8182";

const Row = ({ ok, label }: { ok: boolean; label: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
    <div style={{ flex: "none", width: 92, height: 92, borderRadius: 46, display: "grid", placeItems: "center", background: ok ? PASS : FAIL, color: "#000", font: `700 58px ${SANS}` }}>{ok ? "✓" : "✗"}</div>
    <div style={{ font: `600 46px ${MONO}`, color: ok ? PASS : FAIL }}>{label}</div>
  </div>
);

/** The YouTube thumbnail: the film's opening idea, readable at small sizes. */
export const Thumbnail: React.FC = () => {
  useFontsReady();
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS, padding: "54px 66px", justifyContent: "space-between" }}>
      <div>
        <div style={{ font: `700 112px/1.02 ${SANS}`, letterSpacing: -4, color: "#8a8a8a" }}>AI writes fixes.</div>
        <div style={{ font: `700 112px/1.02 ${SANS}`, letterSpacing: -4 }}>This one proves them.</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "grid", gap: 20 }}>
          <Row ok={false} label="original code" />
          <Row ok label="with the fix" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Logo size={78} />
          <div>
            <div style={{ font: `700 48px/1.05 ${SANS}`, letterSpacing: -1 }}>ThePolisher</div>
            <div style={{ font: `500 25px ${SANS}`, color: "#a3a3a3" }}>on Meta's Muse Spark</div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
