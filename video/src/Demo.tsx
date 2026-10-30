import "@fontsource-variable/mona-sans";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/500.css";
import "../../packages/web/src/index.css";
import { Audio } from "@remotion/media";
import { fade } from "@remotion/transitions/fade";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { AbsoluteFill, staticFile, useCurrentFrame } from "remotion";
import { FPS, SANS, sceneFrames, useFontsReady, type SceneId } from "./common";
import timing from "./timing.json";
import { Agents } from "./scenes/Agents";
import { Close } from "./scenes/Close";
import { Compare } from "./scenes/Compare";
import { Hook } from "./scenes/Hook";
import { Paste } from "./scenes/Paste";
import { Problem } from "./scenes/Problem";
import { ProofScene } from "./scenes/ProofScene";
import { Results } from "./scenes/Results";
import { Safety } from "./scenes/Safety";
import { Vision } from "./scenes/Vision";

const SCENES: Array<{ id: SceneId; C: React.FC }> = [
  { id: "hook", C: Hook },
  { id: "problem", C: Problem },
  { id: "paste", C: Paste },
  { id: "agents", C: Agents },
  { id: "vision", C: Vision },
  { id: "proof", C: ProofScene },
  { id: "compare", C: Compare },
  { id: "results", C: Results },
  { id: "safety", C: Safety },
  { id: "close", C: Close },
];
const FADE = 10;
export const totalFrames = SCENES.reduce((n, s) => n + sceneFrames(s.id), 0) - FADE * (SCENES.length - 1);

/** Burned in: many judges watch muted. */
const Captions = ({ id }: { id: SceneId }) => {
  const t = useCurrentFrame() / FPS;
  const line = timing[id].lines.find((l) => t >= l.start - 0.05 && t < l.end + 0.25);
  if (!line) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 26, display: "flex", justifyContent: "center", zIndex: 50 }}>
      <div style={{ maxWidth: 1600, padding: "10px 24px", borderRadius: 10, background: "rgba(0,0,0,.88)", color: "#fff", font: `500 32px/1.25 ${SANS}`, textAlign: "center" }}>{line.text}</div>
    </div>
  );
};

export const Demo: React.FC = () => {
  useFontsReady();
  return (
    <AbsoluteFill style={{ background: "#000", fontFamily: SANS }}>
      {/* The app's CSS motion can't be frame-accurate here. */}
      <style>{"*,*::before,*::after{transition:none!important;animation:none!important}"}</style>
      <TransitionSeries>
        {SCENES.flatMap(({ id, C }, i) => [
          <TransitionSeries.Sequence key={id} durationInFrames={sceneFrames(id)} name={id}>
            <C />
            <Captions id={id} />
            <Audio src={staticFile(`audio/${id}.wav`)} />
          </TransitionSeries.Sequence>,
          ...(i < SCENES.length - 1 ? [<TransitionSeries.Transition key={`${id}-t`} presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />] : []),
        ])}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
