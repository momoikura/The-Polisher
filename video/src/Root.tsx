import { Composition } from "remotion";
import { Demo, totalFrames } from "./Demo";
import { FPS, HEIGHT, WIDTH } from "./common";

export const RemotionRoot: React.FC = () => (
  <Composition id="ThePolisherDemo" component={Demo} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
);
