/**
 * Line Awesome icons (Icons8, MIT). Rendered as CSS masks so they take the
 * current text color, with no SVG markup injected into the page.
 */

import arrowRight from "line-awesome/svg/arrow-right-solid.svg?url";
import book from "line-awesome/svg/book-open-solid.svg?url";
import brain from "line-awesome/svg/brain-solid.svg?url";
import check from "line-awesome/svg/check-solid.svg?url";
import checkCircle from "line-awesome/svg/check-circle-solid.svg?url";
import circleNotch from "line-awesome/svg/circle-notch-solid.svg?url";
import clock from "line-awesome/svg/clock.svg?url";
import code from "line-awesome/svg/code-solid.svg?url";
import codeBranch from "line-awesome/svg/code-branch-solid.svg?url";
import comment from "line-awesome/svg/comment-dots.svg?url";
import dotCircle from "line-awesome/svg/dot-circle.svg?url";
import exclamation from "line-awesome/svg/exclamation-triangle-solid.svg?url";
import external from "line-awesome/svg/external-link-alt-solid.svg?url";
import eye from "line-awesome/svg/eye-solid.svg?url";
import fileCode from "line-awesome/svg/file-code.svg?url";
import flask from "line-awesome/svg/flask-solid.svg?url";
import github from "line-awesome/svg/github.svg?url";
import history from "line-awesome/svg/history-solid.svg?url";
import info from "line-awesome/svg/info-circle-solid.svg?url";
import pen from "line-awesome/svg/pen-solid.svg?url";
import sync from "line-awesome/svg/sync-solid.svg?url";
import terminal from "line-awesome/svg/terminal-solid.svg?url";
import times from "line-awesome/svg/times-solid.svg?url";
import timesCircle from "line-awesome/svg/times-circle.svg?url";

const ICONS = {
  arrowRight,
  book,
  brain,
  check,
  checkCircle,
  circleNotch,
  clock,
  code,
  codeBranch,
  comment,
  dotCircle,
  exclamation,
  external,
  eye,
  fileCode,
  flask,
  github,
  history,
  info,
  pen,
  sync,
  terminal,
  times,
  timesCircle,
} as const;

export type IconName = keyof typeof ICONS;

type Props = { name: IconName; size?: number; className?: string; label?: string };

export function Icon({ name, size = 16, className = "", label }: Props) {
  const url = `url("${ICONS[name]}")`;
  return (
    <span
      className={`icon ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, WebkitMaskImage: url, maskImage: url }}
    />
  );
}
