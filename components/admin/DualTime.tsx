"use client";

import { useSyncExternalStore } from "react";

const bangkok = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const local = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});
const subscribe = () => () => {};

/**
 * Admin console time: Thailand's, plus the viewer's own time when it differs (CLAUDE.md).
 * Thailand's carries no label (the owner, 13 Oct: everyone knows which time Jaga keeps); the
 * viewer's own carries its zone, which is what tells the two apart.
 * The local part is added in the browser, so server and browser render the same first HTML.
 */
export function DualTime({ iso }: { iso: string }) {
  const date = new Date(iso);
  const localText = useSyncExternalStore(
    subscribe,
    () => local.format(date),
    () => "",
  );
  const sameZone = localText !== "" && new Date().getTimezoneOffset() === -420;
  return (
    <time dateTime={iso} className="tabular-nums">
      {bangkok.format(date)}
      {localText !== "" && !sameZone && ` · ${localText}`}
    </time>
  );
}
