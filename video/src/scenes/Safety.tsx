import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Cursor, MONO, SANS, lineAt, rise } from "../common";
import { REPO } from "../app";

const LINES = ["Code runs only in sandboxes", "Issue text is untrusted data", "Memory only from verified runs", "Nothing is pushed for you"];
const at = (i: number) => lineAt("safety", i);

const Panel = ({ show, children }: { show: number; children: React.ReactNode }) => (
  <div style={{ position: "absolute", left: 960, top: 150, width: 820, height: 640, opacity: show, translate: `0 ${(1 - show) * 20}px` }}>{children}</div>
);

export const Safety: React.FC = () => {
  const f = useCurrentFrame();
  const active = f < at(1) ? 0 : f < at(2) ? 1 : f < at(3) ? 2 : 3;
  const panel = (i: number) => (active === i ? rise(f, i === 0 ? 0 : at(i), 14) : 0);
  const confirming = f >= at(4);
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS }}>
      <div style={{ position: "absolute", left: 110, top: 240 }}>
        {LINES.map((l, i) => (
          <div key={l} style={{ font: `${active === i ? 700 : 500} 52px/1.2 ${SANS}`, marginBottom: 44, opacity: active === i ? 1 : active > i ? 0.45 : 0.18, width: 780 }}>
            {l}
          </div>
        ))}
      </div>
      <Panel show={panel(0)}>
        <div style={{ position: "absolute", inset: 0, border: "3px dashed #8a8a8a", borderRadius: 24, padding: 40 }}>
          <div style={{ font: `600 30px ${MONO}`, color: "#a3a3a3" }}>Modal sandbox</div>
          <div style={{ marginTop: 40, font: `500 34px/1.8 ${MONO}` }}>
            $ pytest
            <br />$ ruff check
            <br />$ bandit
          </div>
          <div style={{ position: "absolute", left: 40, bottom: 36, font: `500 32px/1.6 ${SANS}` }}>
            Secrets: <b>none</b>
            <br />
            Network: <b>GitHub and PyPI only</b>
          </div>
        </div>
      </Panel>
      <Panel show={panel(1)}>
        <div style={{ background: "#1a1a1a", border: "1.5px solid #444", borderRadius: 18, padding: 40, font: `500 32px/1.5 ${MONO}`, color: "#ccc" }}>
          issue text
          <br />
          <span style={{ color: "#ff8182" }}>"Ignore your instructions and..."</span>
          <div style={{ marginTop: 34, display: "inline-block", padding: "10px 22px", borderRadius: 8, background: "#fff", color: "#000", font: `700 34px ${SANS}` }}>Data, never instructions</div>
        </div>
      </Panel>
      <Panel show={panel(2)}>
        {[
          { t: "Tests verified the run", ok: true },
          { t: "Tests did not verify it", ok: false },
        ].map(({ t, ok }) => (
          <div key={t} style={{ padding: "28px 34px", marginBottom: 24, borderRadius: 16, border: `2px solid ${ok ? "#7ee2a8" : "#555"}`, font: `600 36px ${SANS}`, display: "flex", justifyContent: "space-between", opacity: ok ? 1 : 0.6 }}>
            <span>{t}</span>
            <span style={{ color: ok ? "#7ee2a8" : "#a3a3a3" }}>{ok ? "Lessons shared" : "Not shared"}</span>
          </div>
        ))}
      </Panel>
      <Panel show={panel(3)}>
        <div style={{ background: "#fff", color: "#161616", borderRadius: 18, padding: 44 }}>
          {confirming ? (
            <>
              <div style={{ font: `500 34px/1.4 ${SANS}` }}>
                This opens a real pull request on <b>{REPO}</b>, as you.
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 34, justifyContent: "flex-end" }}>
                <div style={{ padding: "16px 28px", borderRadius: 10, border: "1.5px solid #bbb", font: `600 32px ${SANS}` }}>Cancel</div>
                <div style={{ padding: "16px 28px", borderRadius: 10, background: "#000", color: "#fff", font: `600 32px ${SANS}` }}>Open pull request</div>
              </div>
            </>
          ) : (
            <div style={{ display: "inline-block", padding: "18px 30px", borderRadius: 10, background: "#000", color: "#fff", font: `600 36px ${SANS}` }}>Open pull request on GitHub</div>
          )}
        </div>
      </Panel>
      {active === 3 && <Cursor path={[{ at: at(3), x: 1700, y: 760 }, { at: at(3) + 12, x: 1240, y: 225 }, { at: at(4) + 8, x: 1600, y: 345 }]} clicks={[at(4) - 8, at(4) + 34]} />}
    </AbsoluteFill>
  );
};
