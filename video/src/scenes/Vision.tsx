import { useRef } from "react";
import { Img, staticFile, useCurrentFrame } from "remotion";
import type { MaintainerEvent } from "@thepolisher/agents";
import { Timeline } from "../../../packages/web/src/components/Timeline.js";
import { initialView, maintainerReducer } from "../../../packages/web/src/maintainer/reducer.js";
import { Camera, GREEN, Stage, cameraAt, rise, useRects } from "../common";
import { TopBar } from "../app";
import data from "../data/vision.json";

const events = data.events as unknown as MaintainerEvent[];
// Saved locally: GitHub's image links expire after minutes.
const local = data.images as Record<string, string>;
const upToPlan = events.findIndex((e) => e.type === "context" && Boolean(e.screenshots?.length)) + 1;
const view = events.slice(0, upToPlan).reduce(maintainerReducer, initialView());
const feed = view.feed.map((it) => ({ ...it, screenshots: it.screenshots?.map((s) => ({ ...s, url: staticFile(local[s.url]) })) }));
const FIRST = 16;
const SWEEP = 34;

export const Vision: React.FC = () => {
  const f = useCurrentFrame();
  const ref = useRef<HTMLDivElement>(null);
  const rects = useRects(ref, { shots: ".tl-shots", a: ".tl-shots li:nth-child(1) img", b: ".tl-shots li:nth-child(2) img" });
  const r = rects.shots ?? { x: 500, y: 420, w: 800, h: 300 };
  const cam = cameraAt([{ at: 0, x: 720, y: 400, zoom: 1.05 }, { at: 8, x: r.x - r.w / 2 + 400, y: r.y + 40, zoom: 1.7 }], f, 34);
  const scan = (rect: { x: number; y: number; w: number; h: number } | undefined, start: number) => {
    const p = rise(f, start, SWEEP);
    if (!rect || p <= 0 || p >= 1) return null;
    return <div style={{ position: "absolute", left: rect.x - rect.w / 2, width: rect.w, top: rect.y - rect.h / 2 + p * rect.h, height: 2, background: GREEN, zIndex: 5 }} />;
  };
  const noteA = rise(f, FIRST + SWEEP - 6);
  const noteB = rise(f, FIRST + SWEEP * 2 - 6);
  return (
    <>
      {Object.values(local).map((p) => (
        <Img key={p} src={staticFile(p)} style={{ display: "none" }} />
      ))}
      <Stage>
        <Camera x={cam.x} y={cam.y} zoom={cam.zoom} rootRef={ref}>
          <style>{`.tl-shots li:nth-child(1) p{opacity:${noteA}}.tl-shots li:nth-child(2) p{opacity:${noteB}}`}</style>
          <TopBar repo={view.context?.repo} />
          <div className="pr-page" style={{ maxWidth: 1280, margin: "0 auto" }}>
            <h1 style={{ fontSize: 30, margin: "28px 0 24px" }}>
              {view.context?.issue.title} <span style={{ color: "#767676", fontWeight: 400 }}>#{view.context?.issue.number}</span>
            </h1>
            <Timeline items={feed} isLive={false} />
          </div>
          {scan(rects.a, FIRST)}
          {scan(rects.b, FIRST + SWEEP)}
        </Camera>
      </Stage>
    </>
  );
};
