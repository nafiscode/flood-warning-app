"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createServiceAreaMap, TAMBON_FILL_LAYER, TAMBON_SELECTED_LAYER } from "@/lib/map";
import { buttonSecondary, hint } from "@/lib/ui";

type Props = {
  /** Text comes from the server page; `count` contains "{n}" where the number goes. */
  text: {
    useMap: string;
    hideMap: string;
    mapHint: string;
    count: string;
    locked: string;
    mapFailed: string;
  };
};

type MapState = "closed" | "loading" | "ready" | "failed";

function checked(form: ParentNode, name: string): Set<string> {
  return new Set(
    [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
      (input) => input.value,
    ),
  );
}

/** Tambon codes covered by what is ticked in the list: single tambons, districts and provinces. */
function coveredCodes(form: ParentNode): string[] {
  const provinces = checked(form, "province");
  const districts = checked(form, "district");
  return [...form.querySelectorAll<HTMLInputElement>('input[name="tambon"]')]
    .filter(
      (input) =>
        input.checked ||
        districts.has(input.value.slice(0, 4)) ||
        provinces.has(input.value.slice(0, 2)),
    )
    .map((input) => input.value);
}

/**
 * Coverage on a map (spec section 3: "from both a list and a map"). The list of checkboxes in
 * the same fieldset stays the single source of truth: tapping a tambon here ticks or unticks its
 * checkbox, and ticking in the list recolors the map. The form therefore still works without it.
 */
export function CoverageMap({ text }: Props) {
  const [mapState, setMapState] = useState<MapState>("closed");
  const [count, setCount] = useState(0);
  const [locked, setLocked] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const open = mapState !== "closed";

  useEffect(() => {
    const fieldset = root.current?.closest("fieldset");
    if (!open || !container.current || !fieldset) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;

    const paint = () => {
      const codes = coveredCodes(fieldset);
      setCount(codes.length);
      if (map?.getLayer(TAMBON_SELECTED_LAYER)) {
        map.setFilter(TAMBON_SELECTED_LAYER, ["in", ["get", "code"], ["literal", codes]]);
      }
    };
    fieldset.addEventListener("change", paint);

    createServiceAreaMap(container.current)
      .then((created) => {
        if (cancelled) {
          created.remove();
          return;
        }
        map = created;
        created.on("click", TAMBON_FILL_LAYER, (event) => {
          const code = event.features?.[0]?.properties?.code as string | undefined;
          const box = fieldset.querySelector<HTMLInputElement>(
            `input[name="tambon"][value="${CSS.escape(code ?? "")}"]`,
          );
          if (!code || !box) return;
          const whole =
            checked(fieldset, "district").has(code.slice(0, 4)) ||
            checked(fieldset, "province").has(code.slice(0, 2));
          // Ticked as a whole district or province: that is undone in the list, not tambon by tambon.
          setLocked(whole);
          if (whole) return;
          box.checked = !box.checked;
          box.dispatchEvent(new Event("change", { bubbles: true }));
        });
        created.once("load", () => {
          paint();
          setMapState("ready");
        });
        // The basemap replaces the style once; make sure the selection is still shown after it.
        created.on("styledata", paint);
      })
      .catch(() => setMapState("failed"));

    return () => {
      cancelled = true;
      fieldset.removeEventListener("change", paint);
      map?.remove();
    };
  }, [open]);

  return (
    <div ref={root} className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setMapState(open ? "closed" : "loading")}
        aria-expanded={open}
        className={buttonSecondary}
      >
        {open ? text.hideMap : text.useMap}
      </button>
      {open && mapState !== "failed" && (
        <>
          <p className={hint}>{text.mapHint}</p>
          <div
            ref={container}
            data-map-ready={mapState === "ready"}
            className="h-96 w-full overflow-hidden rounded-xl border border-jaga-line"
          />
          <p role="status" className="font-medium">
            {text.count.replace("{n}", String(count))}
            {locked && <span className={`block ${hint}`}>{text.locked}</span>}
          </p>
        </>
      )}
      {mapState === "failed" && (
        <p role="alert" className={hint}>
          {text.mapFailed}
        </p>
      )}
    </div>
  );
}
