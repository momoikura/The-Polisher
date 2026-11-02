import "@fontsource-variable/mona-sans";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/500.css";
import "../../packages/web/src/index.css";
import { Audio } from "@remotion/media";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { AbsoluteFill, Easing, staticFile, useCurrentFrame } from "remotion";
import { FPS, SANS, sceneFrames, useFontsReady, type SceneId } from "./common";
import timing from "./timing.json";
import { iris } from "./transitions";
import { Action } from "./scenes/Action";
import { Agents } from "./scenes/Agents";
import { Check } from "./scenes/Check";
import { Close } from "./scenes/Close";
import { Compare } from "./scenes/Compare";
import { Hook } from "./scenes/Hook";
import { Paste } from "./scenes/Paste";
import { Problem } from "./scenes/Problem";
import { ProofScene } from "./scenes/ProofScene";
import { Results } from "./scenes/Results";
import { Safety } from "./scenes/Safety";
import { Vision } from "./scenes/Vision";
import { Wonder } from "./scenes/Wonder";

// One beat at 120 BPM, so every scene change lands on the music's grid (scripts/music.mjs).
const TRANSITION = 15;
const push = (direction: "from-right" | "from-bottom") => slide({ direction }) as unknown as TransitionPresentation<Record<string, unknown>>;
const SCENES: Array<{ id: SceneId; C: React.FC; into?: TransitionPresentation<Record<string, unknown>> }> = [
  { id: "hook", C: Hook },
  { id: "problem", C: Problem, into: iris() as never },
  { id: "paste", C: Paste, into: push("from-bottom") },
  { id: "agents", C: Agents, into: fade() as never }, // the same screen carries on, so this doesn't show
  { id: "vision", C: Vision, into: push("from-right") },
  { id: "proof", C: ProofScene, into: iris() as never },
  { id: "compare", C: Compare, into: push("from-bottom") },
  { id: "wonder", C: Wonder, into: iris() as never },
  { id: "results", C: Results, into: iris() as never },
  { id: "check", C: Check, into: push("from-right") },
  { id: "action", C: Action, into: fade() as never },
  { id: "safety", C: Safety, into: iris() as never },
  { id: "close", C: Close, into: fade() as never },
];
export const totalFrames = SCENES.reduce((n, s) => n + sceneFrames(s.id), 0) - TRANSITION * (SCENES.length - 1);

/** Burned in: many judges watch muted. */
const Captions = ({ id }: { id: SceneId }) => {
  const t = useCurrentFrame() / FPS;
  const line = timing[id].lines.find((l) => t >= l.start - 0.05 && t < l.end + 0.2);
  if (!line) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 22, display: "flex", justifyContent: "center", zIndex: 50 }}>
      <div style={{ maxWidth: 1600, padding: "9px 22px", borderRadius: 10, background: "rgba(0,0,0,.88)", color: "#fff", font: `500 30px/1.25 ${SANS}`, textAlign: "center" }}>{line.text}</div>
    </div>
  );
};

const EASE = Easing.bezier(0.65, 0, 0.35, 1);

export const Demo: React.FC = () => {
  useFontsReady();
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: SANS }}>
      {/* The app's CSS motion can't be frame-accurate here. */}
      <style>{"*,*::before,*::after{transition:none!important;animation:none!important}"}</style>
      <Audio src={staticFile("audio/score.mp3")} />
      <TransitionSeries>
        {SCENES.flatMap(({ id, C, into }) => [
          ...(into ? [<TransitionSeries.Transition key={`${id}-t`} presentation={into} timing={linearTiming({ durationInFrames: TRANSITION, easing: EASE })} />] : []),
          <TransitionSeries.Sequence key={id} durationInFrames={sceneFrames(id)} name={id}>
            <C />
            <Captions id={id} />
            <Audio src={staticFile(`audio/${id}.wav`)} />
          </TransitionSeries.Sequence>,
        ])}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
