import { AbsoluteFill, useCurrentFrame } from "remotion";
import { GREEN, INK, MONO, MUTED, Reveal, SANS, Words, lineAt, rise, typed } from "../common";

// The real workflow and the real comment, from momoikura/thepolisher-action-demo#1.
const WORKFLOW = `on:
  pull_request_target:
jobs:
  check:
    steps:
      - uses: momoikura/The-Polisher/action@main`;
const at = (i: number) => lineAt("action", i);

export const Action: React.FC = () => {
  const f = useCurrentFrame();
  const comment = rise(f, at(1) + 6, 14);
  return (
    <AbsoluteFill style={{ background: "#fff", color: INK, fontFamily: SANS }}>
      <div style={{ position: "absolute", inset: "64px 110px" }}>
        <Words text="On every pull request." at={at(0) + 2} stagger={2} style={{ font: `700 84px ${SANS}`, letterSpacing: -2.5 }} />
        <div style={{ display: "flex", gap: 44, marginTop: 50, alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 640px", padding: 30, borderRadius: 16, background: "#f6f8fa", border: "1.5px solid #d0d7de", opacity: rise(f, at(0) + 10) }}>
            <div style={{ font: `600 24px ${MONO}`, color: MUTED, marginBottom: 18 }}>.github/workflows/thepolisher.yml</div>
            <div style={{ font: `500 26px/1.6 ${MONO}`, whiteSpace: "pre" }}>{typed(WORKFLOW, f, at(0) + 14, 0.5)}</div>
          </div>
          <div style={{ flex: 1, borderRadius: 16, border: "1.5px solid #d0d7de", overflow: "hidden", opacity: comment, translate: `0 ${(1 - comment) * 20}px` }}>
            <div style={{ padding: "16px 24px", background: "#f6f8fa", borderBottom: "1.5px solid #d0d7de", font: `600 26px ${SANS}` }}>
              github-actions <span style={{ fontWeight: 500, color: MUTED }}>commented</span>
            </div>
            <div style={{ padding: "22px 26px", font: `500 27px/1.5 ${SANS}` }}>
              <div>
                <span style={{ color: GREEN }}>●</span> <b>Its tests show it works.</b> Its tests fail on the original code and pass with this PR. 3 of 3 tests pass.
              </div>
              <Reveal at={at(1) + 22} style={{ marginTop: 14 }}>
                <span style={{ color: GREEN }}>●</span> Independent edge-case tests by muse-wonder-1.0: 3 of 3 pass.
              </Reveal>
            </div>
          </div>
        </div>
        <Reveal at={at(1) + 30} style={{ font: `500 28px ${SANS}`, color: MUTED, marginTop: 30 }}>
          On a demo repo: the check took about a minute, and the PR's code never ran on GitHub's machines.
        </Reveal>
      </div>
    </AbsoluteFill>
  );
};
