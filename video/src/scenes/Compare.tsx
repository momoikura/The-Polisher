import { useCurrentFrame } from "remotion";
import { Camera, Stage, cameraAt, lineAt, rise } from "../common";
import { PrPage, REPO, TopBar, finalRich } from "../app";

export const Compare: React.FC = () => {
  const f = useCurrentFrame();
  const l1 = lineAt("compare", 1);
  const cam = cameraAt([{ at: 0, x: 720, y: 560, zoom: 1.08 }, { at: l1 - 12, x: 720, y: 600, zoom: 1.08 }], f);
  const mark = rise(f, l1 + 6, 12);
  return (
    <Stage>
      <Camera x={cam.x} y={cam.y} zoom={cam.zoom}>
        <style>{`.cmp-table td.is-better{background:rgba(26,127,55,${0.16 * mark})}`}</style>
        <TopBar repo={REPO} />
        <PrPage view={finalRich} tab={f < l1 - 12 ? "files" : "comparison"} />
      </Camera>
    </Stage>
  );
};
