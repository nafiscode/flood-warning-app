import { describe, expect, it } from "vitest";
import { SosPulseNotice } from "@/components/map/SosPulseNotice";
import {
  SOS_PULSE_FRESH_MS,
  freshPulseRows,
  pulseCodes,
  toSosPulseRows,
  waitParts,
  type SosPulse,
  type SosPulseRow,
} from "@/lib/sos-pulse";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const row = (more: Partial<SosPulseRow> = {}): SosPulseRow => ({
  tambon: "940104",
  province: "94",
  nameTh: "บานา",
  nameEn: "Bana",
  districtTh: "เมืองปัตตานี",
  provinceTh: "ปัตตานี",
  cases: 2,
  waitingMinutes: 130,
  ...more,
});

describe("the rows the database gives", () => {
  it("keeps only tambons with a case, and nothing finer than the tambon", () => {
    const rows = toSosPulseRows([
      {
        tambon: "940104",
        province_code: "94",
        name_th: "บานา",
        name_en: "Bana",
        district_th: "เมืองปัตตานี",
        province_th: "ปัตตานี",
        cases: 2,
        waiting_minutes: 130,
        // Even if a future function leaked these, the map's own shape has no place for them.
        lat: 6.8,
        lon: 101.2,
        phone: "0811111111",
      },
      { tambon: "940105", cases: 0 },
      { tambon: "not-a-code", cases: 3 },
    ]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "cases",
        "districtTh",
        "nameEn",
        "nameTh",
        "province",
        "provinceTh",
        "tambon",
        "waitingMinutes",
      ].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("0811111111");
  });

  it("gives the map one sorted, de-duplicated list of codes", () => {
    expect(pulseCodes([row({ tambon: "940200" }), row(), row({ tambon: "940200" })])).toEqual([
      "940104",
      "940200",
    ]);
    expect(pulseCodes(null)).toEqual([]);
  });
});

describe("how long a signal may stand on the map", () => {
  const pulse: SosPulse = { rows: [row()], asOf: "2026-11-27T10:00:00Z" };
  const asked = Date.parse("2026-11-27T10:00:00Z");

  it("is shown while the last answer is fresh", () => {
    expect(freshPulseRows(pulse, asked, asked + 60_000)).toHaveLength(1);
    expect(freshPulseRows(pulse, asked, asked + SOS_PULSE_FRESH_MS)).toHaveLength(1);
  });

  it("is dropped once the last answer is older than five minutes, or there never was one", () => {
    expect(freshPulseRows(pulse, asked, asked + SOS_PULSE_FRESH_MS + 1)).toEqual([]);
    expect(freshPulseRows(null, 0, asked)).toEqual([]);
    expect(freshPulseRows(pulse, 0, asked)).toEqual([]);
  });

  it("splits a waiting time into hours and minutes", () => {
    expect(waitParts(130)).toEqual({ hours: 2, minutes: 10 });
    expect(waitParts(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("the notice above the map", () => {
  it("says in words where help is wanted and that no team has taken it, with the hotlines", () => {
    const { container, getByText } = renderWithIntl(<SosPulseNotice rows={[row()]} />);
    expect(getByText(th.map.sosPulse.title)).toBeTruthy();
    expect(container.textContent).toContain("บานา");
    expect(container.textContent).toContain("2 คำขอ");
    expect(container.textContent).toContain("2 ชม. 10 น.");
    const calls = [...container.querySelectorAll("a[href^='tel:']")].map((a) =>
      a.getAttribute("href"),
    );
    expect(calls).toEqual(["tel:1784", "tel:1669"]);
    // It never claims that nobody will come (safety rule 10), and names no place or person.
    expect(container.textContent).not.toMatch(/ไม่มีใครมา/);
    expect(container.querySelector("[data-sos-pulse]")?.getAttribute("role")).toBe("status");
  });

  it("draws nothing when nobody is waiting", () => {
    const { container } = renderWithIntl(<SosPulseNotice rows={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("reads in Malay and in English, with the Latin spelling of the tambon", () => {
    const eng = renderWithIntl(<SosPulseNotice rows={[row({ waitingMinutes: 20 })]} />, "en");
    expect(eng.container.textContent).toContain(en.map.sosPulse.title);
    expect(eng.container.textContent).toContain("Bana");
    expect(eng.container.textContent).toContain("2 requests");
    const may = renderWithIntl(<SosPulseNotice rows={[row()]} />, "ms");
    expect(may.container.textContent).toContain(ms.map.sosPulse.title);
  });
});
