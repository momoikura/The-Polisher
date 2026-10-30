import { useLayoutEffect, useRef } from "react";
import { Sequence, interpolate, useCurrentFrame } from "remotion";
import { IssueForm } from "../../../packages/web/src/components/IssueForm.js";
import { BASE, CENTER_Y, Camera, Cursor, SANS, WIDTH, cameraAt, lineAt, rise, sceneFrames, typed, useRects } from "../common";
import { ISSUE, PrPage, REPO, TopBar, clock, eventIndex, richEvents, viewFrom } from "../app";

const config = { provider: "meta", isSimulated: false, isConfigured: true, model: "muse-spark-1.3-contributor", setupHint: null, isSandboxConfigured: true, prAccess: "sign_in", demoIssueUrl: null, activeRunId: null, isAuthEnabled: true, requiresUserKey: true, freeRunsLeft: 3, freeRunsPerUser: 3 };
const user = { login: "you", name: "You", avatarUrl: "", hasSavedKey: true };
const CLICK = lineAt("paste", 1) - 4;
const END = eventIndex("candidates") + 4;

/** The real issue form, with the link typed into its real input. */
const Form: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const text = typed(ISSUE.url, f, 18, 0.6);
  useLayoutEffect(() => {
    const input = ref.current?.querySelector("input") as HTMLInputElement | null;
    if (input) input.value = text;
  }); // after every render: React restores the controlled input's empty value
  const rects = useRects(ref, { input: "input", go: "button[type=submit]" });
  const goY = rects.go?.y ?? 800;
  const shot = cameraAt([{ at: 0, x: 720, y: 400, zoom: 1 }, { at: 8, x: 720, y: 450, zoom: 1.08 }, { at: CLICK - 42, x: 720, y: goY - 170, zoom: 1.08 }], f);
  const s = BASE * shot.zoom;
  const toScreen = (r: { x: number; y: number } | undefined, dx = 0) => (r ? { x: WIDTH / 2 - shot.x * s + (r.x + dx) * s, y: CENTER_Y - shot.y * s + r.y * s } : { x: 1400, y: 900 });
  const input = toScreen(rects.input, -160);
  const go = toScreen(rects.go);
  return (
    <>
      <Camera x={shot.x} y={shot.y} zoom={shot.zoom} rootRef={ref}>
        <TopBar />
        <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 0" }}>
          <IssueForm config={config as never} user={user as never} isStarting={false} error={null} onStart={() => {}} onForgetKey={async () => null} />
        </main>
      </Camera>
      <Cursor path={[{ at: 0, x: 1500, y: 900 }, { at: 2, x: input.x, y: input.y }, { at: CLICK - 26, x: go.x, y: go.y }]} clicks={[8, CLICK - 6]} />
    </>
  );
};

export const Clock = ({ n }: { n: number }) => (
  <div style={{ position: "absolute", left: "50%", translate: "-50% 0", top: 22, zIndex: 40, padding: "10px 20px", borderRadius: 30, background: "#fff", color: "#000", font: `600 26px ${SANS}`, boxShadow: "0 2px 12px rgba(0,0,0,.25)" }}>
    Real run, sped up · {clock(n)}
  </div>
);

const Run: React.FC = () => {
  const f = useCurrentFrame();
  const span = sceneFrames("paste") - CLICK;
  const n = Math.round(interpolate(f, [0, span * 0.85], [1, END], { extrapolateRight: "clamp" }));
  const zoom = rise(f, lineAt("paste", 2) - CLICK, 26);
  return (
    <>
      <Camera x={720} y={364 + 150 * zoom} zoom={1 + 0.14 * zoom}>
        <TopBar repo={REPO} />
        <PrPage view={viewFrom(richEvents, n)} />
      </Camera>
      <Clock n={n} />
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
