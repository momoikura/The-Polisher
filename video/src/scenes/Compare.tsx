import { useCurrentFrame } from "remotion";
import { Camera, cameraAt, lineAt } from "../common";
import { PrPage, REPO, TopBar, finalRich } from "../app";

export const Compare: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = lineAt("compare", 1);
  const cam = cameraAt([{ at: 0, x: 720, y: 620, zoom: 1.1 }, { at: l1, x: 720, y: 560, zoom: 1.05 }, { at: lineAt("compare", 2), x: 720, y: 640, zoom: 1.1 }], f);
  return (
    <Camera x={cam.x} y={cam.y} zoom={cam.zoom}>
      <TopBar repo={REPO} />
      <PrPage view={finalRich} tab={f < l1 ? "files" : "comparison"} />
    </Camera>
  );
};
