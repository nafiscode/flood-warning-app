import { describe, expect, it, vi } from "vitest";
import { FloodScene } from "@/components/map/FloodScene";
import type { Gauge } from "@/lib/map-data";
import { renderWithIntl } from "./render";

/*
 * The full-screen flood scene (the owner, 24 Nov 2026). It renders only measured facts and must
 * say, in words, that it is a measurement and not an official alert - and it must do so in every
 * language, so a missing copy key here is a test failure, not a blank on a phone.
 */
const OVER: Gauge = {
  id: "X.44",
  name: { th: "คลองอู่ตะเภา", en: "U-Tapao" },
  lat: 7.0,
  lon: 100.47,
  value: 8.37,
  observedAt: "2026-11-24T06:20:00Z",
  status: "above_evacuate",
  watch: 6,
  warning: 7,
  evacuate: 8,
  bank: 8,
  provisionalLevels: true,
};

describe("FloodScene", () => {
  for (const locale of ["th", "en", "ms"] as const) {
    it(`renders the measured facts and the not-an-alert line (${locale})`, () => {
      const onClose = vi.fn();
      const { container, getByText } = renderWithIntl(
        <FloodScene gauge={OVER} areaName="Hat Yai" onClose={onClose} />,
        locale,
      );
      // The scene is there, keyed to the gauge, and carries the over-bank figure.
      expect(container.querySelector(`[data-flood-scene="X.44"]`)).not.toBeNull();
      expect(container.querySelector("[data-flood-over]")).not.toBeNull();
      // The measurement disclaimer and the controls are present (no unresolved i18n key).
      expect(container.querySelector("[data-flood-measurement]")).not.toBeNull();
      expect(container.querySelector("[data-flood-close]")).not.toBeNull();
      expect(container.querySelector("[data-flood-replay]")).not.toBeNull();
      // English copy is checked by its words, so a silent fallback can't pass.
      if (locale === "en") {
        getByText("0.37 m over the bank");
        getByText("Your area: Hat Yai");
      }
    });
  }

  it("still renders when the person has no saved area (no 'your area' line)", () => {
    const { container, queryByText } = renderWithIntl(
      <FloodScene gauge={OVER} onClose={vi.fn()} />,
      "en",
    );
    expect(container.querySelector(`[data-flood-scene="X.44"]`)).not.toBeNull();
    expect(queryByText(/Your area:/)).toBeNull();
  });
});
