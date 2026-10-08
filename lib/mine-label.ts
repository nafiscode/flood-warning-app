import type { MinePlace } from "@/components/map/MapView";

/**
 * The label on one of the person's own places: the name they gave it, the person there and the
 * address. Built as text nodes, never as HTML, because every line is something they typed.
 */
export function mineLabel(place: MinePlace): HTMLElement {
  const box = document.createElement("div");
  box.className = "flex flex-col gap-0.5 text-jaga-text";
  const name = document.createElement("b");
  name.textContent = place.label;
  box.append(name);
  for (const line of place.lines) {
    const p = document.createElement("span");
    p.className = "text-small";
    p.textContent = line;
    box.append(p);
  }
  return box;
}

/**
 * One of the person's places as the map's source holds it. The name travels in the properties
 * because the symbol layer writes it on the map from there; leaving it out once meant the pins
 * were drawn with no names at all, which nothing but a screenshot would have caught.
 */
export function minePlaceFeature(place: MinePlace) {
  return {
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [place.lon, place.lat] },
    properties: {
      id: place.id,
      home: place.home ? 1 : 0,
      color: place.color,
      label: place.label,
    },
  };
}
