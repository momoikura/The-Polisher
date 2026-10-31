import type { TransitionPresentation, TransitionPresentationComponentProps } from "@remotion/transitions";
import { AbsoluteFill } from "remotion";

/** A circle opens out of the middle of the frame into the next scene. */
const IrisView: React.FC<TransitionPresentationComponentProps<Record<string, never>>> = ({ children, presentationDirection, presentationProgress }) => (
  <AbsoluteFill style={presentationDirection === "entering" ? { clipPath: `circle(${presentationProgress * 120}% at 50% 46%)` } : undefined}>{children}</AbsoluteFill>
);

export const iris = (): TransitionPresentation<Record<string, never>> => ({ component: IrisView, props: {} });
