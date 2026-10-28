import { useEffect, useRef } from "react";
import type { FeedItem } from "../maintainer/reducer.js";
import { AGENT } from "../maintainer/reducer.js";
import { LANE_META } from "../maintainer/lanes.js";
import { Icon, type IconName } from "./Icon.js";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function badgeFor(item: FeedItem): IconName {
  if (item.tone === "good") return "check";
  if (item.tone === "bad") return "times";
  if (item.text.startsWith("→")) return "comment";
  if (item.text.startsWith("Recalled") || item.text.startsWith("Remembered")) return "history";
  if (item.text.startsWith("Changes approach")) return "sync";
  if (item.text.startsWith("Candidate") || item.text.startsWith("Tested ")) return "flask";
  return item.lane ? LANE_META[item.lane].icon : "sync";
}

/** The run as a pull request conversation: one event per row, newest at the bottom. */
export function Timeline({ items, isLive }: { items: FeedItem[]; isLive: boolean }) {
  const endRef = useRef<HTMLLIElement>(null);
  const isPinnedRef = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      isPinnedRef.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isLive && isPinnedRef.current) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [items, isLive]);

  return (
    <ol className="timeline" aria-label="Activity" aria-live="polite" aria-relevant="additions">
      {items.map((item) => (
        <li key={item.id} className={`tl-item tone-${item.tone}`}>
          <span className="tl-badge" aria-hidden="true">
            <Icon name={badgeFor(item)} size={14} />
          </span>
          <p className="tl-body">
            <strong>{item.lane ? AGENT[item.lane] : "The Polisher"}</strong> <span className="tl-text">{item.text}</span>
          </p>
          <time className="tl-time mono">{timeFormat.format(item.at)}</time>
        </li>
      ))}
      {isLive && (
        <li ref={endRef} className="tl-item tl-live">
          <span className="tl-badge" aria-hidden="true">
            <Icon name="circleNotch" size={14} className="spin" />
          </span>
          <p className="tl-body muted">Working…</p>
        </li>
      )}
    </ol>
  );
}
