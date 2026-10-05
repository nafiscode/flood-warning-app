"use client";

import { useState } from "react";
import { buttonSecondary, hint } from "@/lib/ui";

type Props = {
  /** Text comes from the server page, so no messages are shipped to the browser for this. */
  text: { useGps: string; locating: string; found: string; failed: string; clear: string };
  initial?: { lat: number; lon: number } | null;
};

type State = "idle" | "locating" | "failed";

/**
 * Home location from the phone's GPS. Optional: the form saves without it. The coordinates go
 * into hidden fields; the server works out the tambon, never the browser.
 */
export function HomeLocationField({ text, initial = null }: Props) {
  const [point, setPoint] = useState(initial);
  const [state, setState] = useState<State>("idle");

  function locate() {
    if (!("geolocation" in navigator)) {
      setState("failed");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint({ lat: position.coords.latitude, lon: position.coords.longitude });
        setState("idle");
      },
      () => setState("failed"),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="lat" value={point ? point.lat.toFixed(6) : ""} />
      <input type="hidden" name="lon" value={point ? point.lon.toFixed(6) : ""} />
      <button
        type="button"
        onClick={locate}
        disabled={state === "locating"}
        className={buttonSecondary}
      >
        {state === "locating" ? text.locating : text.useGps}
      </button>
      <p role="status" className={hint}>
        {state === "failed" && text.failed}
        {state !== "failed" &&
          point &&
          `${text.found} ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`}
      </p>
      {point && (
        <button
          type="button"
          onClick={() => setPoint(null)}
          className="min-h-tap self-start underline"
        >
          {text.clear}
        </button>
      )}
    </div>
  );
}
