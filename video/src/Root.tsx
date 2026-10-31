import { Composition, Still } from "remotion";
import { Demo, totalFrames } from "./Demo";
import { Thumbnail } from "./Thumbnail";
import { FPS, HEIGHT, WIDTH } from "./common";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="ThePolisherDemo" component={Demo} durationInFrames={totalFrames} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Still id="Thumbnail" component={Thumbnail} width={1280} height={720} />
  </>
);
