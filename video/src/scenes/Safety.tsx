import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Cursor, MONO, SANS, Words, lineAt, rise, typed } from "../common";
import { REPO } from "../app";
import beats from "../beats.json";

const LINES = ["Code runs only in sandboxes", "Issue text is data, never instructions", "Memory only from verified runs", "Nothing is pushed for you"];
const at = (i: number) => lineAt("safety", i);

const Panel = ({ show, children }: { show: number; children: React.ReactNode }) => (
  <div style={{ position: "absolute", left: 980, top: 170, width: 810, height: 620, opacity: show, translate: `0 ${(1 - show) * 24}px` }}>{children}</div>
);

export const Safety: React.FC = () => {
  const f = useCurrentFrame();
  const intro = rise(f, at(1) - 8, 10);
  const active = f < at(2) ? 0 : f < at(3) ? 1 : f < at(4) ? 2 : 3;
  const panel = (i: number) => (active === i ? rise(f, at(i + 1), 14) : 0);
  const clickAt = at(4) + Math.round(beats.safetyClick * 30);
  const confirming = f >= clickAt;
  const seal = rise(f, at(1) + 6, 26);
  return (
    <AbsoluteFill style={{ background: "#000", color: "#fff", fontFamily: SANS }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: 1 - intro }}>
        <Words text="You stay in control." at={at(0) + 2} style={{ font: `700 130px ${SANS}`, letterSpacing: -4 }} />
      </AbsoluteFill>
      {intro > 0 && (
        <div style={{ opacity: intro }}>
          <div style={{ position: "absolute", left: 110, top: 240 }}>
            {LINES.map((l, i) => (
              <div key={l} style={{ font: `${active === i ? 700 : 500} 48px/1.2 ${SANS}`, marginBottom: 44, opacity: active === i ? 1 : active > i ? 0.45 : 0.18, width: 800 }}>
                {l}
              </div>
            ))}
          </div>
          <Panel show={panel(0)}>
            {/* The sandbox's walls draw themselves closed around the code. */}
            <svg width="810" height="620" style={{ position: "absolute", inset: 0 }}>
              <rect x="3" y="3" width="804" height="614" rx="24" fill="none" stroke="#8a8a8a" strokeWidth="3" strokeDasharray="2836" strokeDashoffset={2836 * (1 - seal)} />
            </svg>
            <div style={{ position: "absolute", inset: 0, padding: 40 }}>
              <div style={{ font: `600 30px ${MONO}`, color: "#a3a3a3" }}>Modal sandbox</div>
              <div style={{ marginTop: 36, font: `500 36px/1.8 ${MONO}`, whiteSpace: "pre" }}>{typed("$ pytest\n$ ruff check\n$ bandit", f, at(1) + 10, 0.8)}</div>
              <div style={{ position: "absolute", left: 40, bottom: 36, font: `500 32px/1.6 ${SANS}`, opacity: rise(f, at(1) + 34) }}>
                Secrets: <b>none</b>
                <br />
                Network: <b>GitHub and PyPI only</b>
              </div>
            </div>
          </Panel>
          <Panel show={panel(1)}>
            <div style={{ background: "#1a1a1a", border: "1.5px solid #444", borderRadius: 18, padding: 40, font: `500 32px/1.5 ${MONO}`, color: "#ccc" }}>
              example issue text
              <br />
              <span style={{ color: "#ff8182", textDecoration: f >= at(2) + 26 ? "line-through" : "none" }}>"Ignore your instructions and..."</span>
              <div style={{ marginTop: 34, display: "inline-block", padding: "10px 22px", borderRadius: 8, background: "#fff", color: "#000", font: `700 34px ${SANS}`, opacity: rise(f, at(2) + 26), scale: 1.08 - 0.08 * rise(f, at(2) + 26, 10) }}>Treated as data</div>
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
          {active === 3 && <Cursor path={[{ at: at(4), x: 1760, y: 780 }, { at: clickAt - 22, x: 1260, y: 235 }, { at: clickAt + 14, x: 1620, y: 365 }]} clicks={[clickAt - 4, clickAt + 36]} />}
        </div>
      )}
    </AbsoluteFill>
  );
};
