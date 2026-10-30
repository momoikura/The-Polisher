import { useRef } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import type { MaintainerEvent } from "@thepolisher/agents";
import { Timeline } from "../../../packages/web/src/components/Timeline.js";
import { initialView, maintainerReducer } from "../../../packages/web/src/maintainer/reducer.js";
import { Camera, cameraAt, useRects } from "../common";
import { TopBar } from "../app";
import data from "../data/vision.json";

const events = data.events as unknown as MaintainerEvent[];
// Saved locally: GitHub's image links expire after minutes.
const local = data.images as Record<string, string>;
const upToPlan = events.findIndex((e) => e.type === "context" && Boolean(e.screenshots?.length)) + 1;
const view = events.slice(0, upToPlan).reduce(maintainerReducer, initialView());
const feed = view.feed.map((it) => ({ ...it, screenshots: it.screenshots?.map((s) => ({ ...s, url: staticFile(local[s.url]) })) }));

export const Vision: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const r = useRects(ref, { shots: ".tl-shots" }).shots ?? { x: 500, y: 420, w: 800, h: 300 };
  const cam = cameraAt([{ at: 0, x: 720, y: 400, zoom: 1.05 }, { at: 10, x: r.x - r.w / 2 + 470, y: r.y - 60, zoom: 1.25 }], f, 40);
  return (
    <>
      {Object.values(local).map((p) => (
        <Img key={p} src={staticFile(p)} style={{ display: "none" }} />
      ))}
      <Camera x={cam.x} y={cam.y} zoom={cam.zoom} rootRef={ref}>
        <TopBar repo={view.context?.repo} />
        <div className="pr-page" style={{ maxWidth: 1280, margin: "0 auto" }}>
          <h1 style={{ fontSize: 30, margin: "28px 0 24px" }}>
            {view.context?.issue.title} <span style={{ color: "#767676", fontWeight: 400 }}>#{view.context?.issue.number}</span>
          </h1>
          <Timeline items={feed} isLive={false} />
        </div>
      </Camera>
    </>
  );
};
