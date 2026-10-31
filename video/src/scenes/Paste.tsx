import { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import type { CandidateSummary } from "@thepolisher/agents";
import { IssueForm } from "../../../packages/web/src/components/IssueForm.js";
import { BASE, CENTER_Y, Camera, Cursor, GREEN, MONO, SANS, Stage, WIDTH, cameraAt, lineAt, rise, sceneFrames, typed, useRects } from "../common";
import { ISSUE, PrPage, REPO, TopBar, clock, eventIndex, richEvents, viewFrom } from "../app";

const config = { provider: "meta", isSimulated: false, isConfigured: true, model: "muse-spark-1.3-contributor", setupHint: null, isSandboxConfigured: true, prAccess: "sign_in", demoIssueUrl: null, activeRunId: null, isAuthEnabled: true, requiresUserKey: true, freeRunsLeft: 3, freeRunsPerUser: 3 };
const user = { login: "you", name: "You", avatarUrl: "", hasSavedKey: true };
const CLICK = lineAt("paste", 1) - 6;
const END = eventIndex("candidates") + 4;
const candidates = (richEvents[eventIndex("candidates")] as unknown as { candidates: CandidateSummary[] }).candidates;

/** The real issue form, with the link typed into its real input. */
const Form: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const text = typed(ISSUE.url, f, 14, 0.5);
  useLayoutEffect(() => {
    const input = ref.current?.querySelector("input") as HTMLInputElement | null;
    if (input) input.value = text;
  }); // after every render: React restores the controlled input's empty value
  const rects = useRects(ref, { input: "input", go: "button[type=submit]" });
  const goY = rects.go?.y ?? 800;
  const shot = cameraAt([{ at: 0, x: 720, y: 400, zoom: 1 }, { at: 6, x: 720, y: 450, zoom: 1.08 }, { at: CLICK - 30, x: 720, y: goY - 170, zoom: 1.08 }], f);
  const s = BASE * shot.zoom;
  const toScreen = (r: { x: number; y: number } | undefined, dx = 0) => (r ? { x: WIDTH / 2 - shot.x * s + (r.x + dx) * s, y: CENTER_Y - shot.y * s + r.y * s } : { x: 1400, y: 900 });
  const input = toScreen(rects.input, -160);
  const go = toScreen(rects.go);
  const settle = rise(f, 0, 30);
  return (
    <Stage tiltX={(1 - settle) * 16} tiltY={(1 - settle) * -10} scale={0.86 + 0.08 * settle}>
      <Camera x={shot.x} y={shot.y} zoom={shot.zoom} rootRef={ref}>
        {/* The real button enables from React state, which this typed value doesn't touch. */}
        {text.length === ISSUE.url.length && <style>{"button[type=submit]{background:#000!important;color:#fff!important;opacity:1!important}"}</style>}
        <TopBar />
        <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 0" }}>
          <IssueForm config={config as never} user={user as never} isStarting={false} error={null} onStart={() => {}} onForgetKey={async () => null} />
        </main>
      </Camera>
      <Cursor path={[{ at: 0, x: 1500, y: 900 }, { at: 2, x: input.x, y: input.y }, { at: CLICK - 22, x: go.x, y: go.y }]} clicks={[8, CLICK - 6]} />
    </Stage>
  );
};

export const Clock = ({ n }: { n: number }) => (
  <div style={{ position: "absolute", left: "50%", translate: "-50% 0", top: 10, zIndex: 40, padding: "8px 18px", borderRadius: 30, background: "#fff", color: "#000", font: `600 24px ${SANS}`, boxShadow: "0 2px 12px rgba(0,0,0,.35)" }}>
    Real run, sped up · {clock(n)}
  </div>
);

/** The three drafts, with the numbers the sandbox reported for each. */
const Race = ({ start }: { start: number }) => {
  const f = useCurrentFrame();
  const picked = start + 63;
  return (
    <AbsoluteFill style={{ background: `rgba(0,0,0,${0.72 * rise(f, start, 12)})`, justifyContent: "center", alignItems: "center", paddingBottom: 90, fontFamily: SANS }}>
      <div style={{ width: 1280, opacity: rise(f, start + 4, 12), translate: `0 ${(1 - rise(f, start + 4, 14)) * 30}px` }}>
        <div style={{ color: "#fff", font: `700 60px ${SANS}`, letterSpacing: -1.5, marginBottom: 26 }}>Three fixes. The tests decide.</div>
        {candidates.map((c, i) => {
          const fill = rise(f, start + 10 + i * 3, 42 + i * 4);
          const isWinner = f >= picked && c.chosen;
          const isOut = f >= picked && !c.chosen;
          return (
            <div key={c.index} style={{ position: "relative", height: 112, marginBottom: 16, borderRadius: 14, overflow: "hidden", background: "#1a1a1a", opacity: isOut ? 0.45 : 1, scale: isWinner ? 1 + 0.025 * rise(f, picked, 12) : 1 }}>
              <div style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, background: isWinner ? "#fff" : "#333" }} />
              <div style={{ position: "absolute", inset: 0, padding: "0 30px", display: "flex", alignItems: "center", justifyContent: "space-between", color: isWinner ? "#000" : "#fff", font: `600 38px ${SANS}` }}>
                <span>Draft {c.index + 1}</span>
                <span style={{ opacity: fill > 0.9 ? 1 : 0, font: `500 30px ${MONO}` }}>
                  {c.testsPassed}/{c.testsTotal} tests, +{c.linesAdded} lines
                </span>
                <span style={{ width: 170, textAlign: "right", color: isWinner ? GREEN : "#a3a3a3", font: `700 34px ${SANS}`, opacity: fill > 0.9 ? 1 : 0 }}>{isWinner ? "✓ Chosen" : c.provesFix ? "proves it" : "no proof"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const Run: React.FC = () => {
  const f = useCurrentFrame();
  const span = sceneFrames("paste") - CLICK;
  const n = Math.round(interpolate(f, [0, span * 0.5], [1, END], { extrapolateRight: "clamp" }));
  const drift = rise(f, 0, 90);
  return (
    <>
      <Stage tiltX={2.5 * (1 - drift)} tiltY={-3 * (1 - drift)}>
        <Camera x={720} y={364 + 120 * drift} zoom={1 + 0.1 * drift}>
          <TopBar repo={REPO} />
          <PrPage view={viewFrom(richEvents, n)} />
        </Camera>
      </Stage>
      <Clock n={n} />
      <Race start={lineAt("paste", 2) - CLICK} />
    </>
  );
};

export const Paste: React.FC = () => (
  <>
    <Sequence name="form" durationInFrames={CLICK}>
      <Form />
    </Sequence>
    <Sequence name="run" from={CLICK}>
      <Run />
    </Sequence>
  </>
);
