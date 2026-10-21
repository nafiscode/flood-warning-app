import { describe, expect, it } from "vitest";
import { PROVINCES } from "@/lib/coverage";
import {
  alertsIn,
  isPlaceSlug,
  PLACE_PATHS,
  PLACE_SLUGS,
  PLACES,
  PROVINCE_SLUGS,
} from "@/lib/flood-places";
import type { PublicAlert } from "@/lib/public-status";
import { INDEXED_PATHS } from "@/lib/seo";

/**
 * The flood pages (A10). What is held here is the part a wrong answer would make unsafe: that a
 * page shows the alerts of its own place and nobody else's, and that no page exists for somewhere
 * Jaga does not cover (safety rule 10).
 */

const alert = (id: string, tambons: string[]): PublicAlert =>
  ({ id, level: "warning", tambons }) as PublicAlert;

describe("the places with a page", () => {
  it("cover all four provinces and nothing outside them", () => {
    expect([...PROVINCE_SLUGS.map((slug) => PLACES[slug]!.code)].sort()).toEqual(
      [...PROVINCES].sort(),
    );
    // Every district page sits inside a covered province.
    for (const slug of PLACE_SLUGS) {
      const { code, kind } = PLACES[slug]!;
      expect(code).toMatch(kind === "province" ? /^[0-9]{2}$/ : /^[0-9]{4}$/);
      expect(PROVINCES, `${slug} (${code}) is outside the covered provinces`).toContain(
        code.slice(0, 2),
      );
    }
  });

  it("include Hat Yai, which is searched more than Songkhla is", () => {
    expect(PLACES["hat-yai"]).toEqual({ code: "9011", kind: "district" });
  });

  it("each have one address, and every address is offered for crawling", () => {
    expect(PLACE_PATHS).toEqual(PLACE_SLUGS.map((slug) => `/flood/${slug}`));
    expect(new Set(PLACE_PATHS).size).toBe(PLACE_PATHS.length);
    for (const path of PLACE_PATHS) expect(INDEXED_PATHS).toContain(path);
  });

  it("are the only slugs the route accepts", () => {
    for (const slug of PLACE_SLUGS) expect(isPlaceSlug(slug)).toBe(true);
    // Phuket and Krabi flood too; Jaga does not cover them, so they get no page.
    for (const other of ["phuket", "krabi", "", "94", "9011", "../map", "__proto__", "toString"]) {
      expect(isPlaceSlug(other), `${other} must not be a place slug`).toBe(false);
    }
  });

  it("use codes a tambon code can be matched against by prefix", () => {
    // Hat Yai's tambons all begin 9011, and Hat Yai begins with Songkhla's 90.
    expect(PLACES["hat-yai"]!.code.startsWith(PLACES.songkhla!.code)).toBe(true);
  });
});

describe("the alerts on a place's page", () => {
  const alerts = [
    alert("a", ["940101", "940102"]), // Mueang Pattani
    alert("b", ["950301"]), // Bannang Sata, Yala
    alert("c", ["960101", "940501"]),
    alert("d", ["901101"]), // Hat Yai, Songkhla
    alert("e", []),
  ];

  it("are the ones naming a tambon of that place, and no others", () => {
    expect(alertsIn("94", alerts).map((found) => found.id)).toEqual(["a", "c"]);
    expect(alertsIn("95", alerts).map((found) => found.id)).toEqual(["b"]);
    expect(alertsIn("90", alerts).map((found) => found.id)).toEqual(["d"]);
  });

  it("narrow correctly from a province to one of its districts", () => {
    // Songkhla has the Hat Yai alert; Hat Yai has it too; Mueang Songkhla does not.
    expect(alertsIn("9011", alerts).map((found) => found.id)).toEqual(["d"]);
    expect(alertsIn("9001", alerts)).toEqual([]);
    // Bannang Sata holds Yala's, and Mueang Yala does not.
    expect(alertsIn("9503", alerts).map((found) => found.id)).toEqual(["b"]);
    expect(alertsIn("9501", alerts)).toEqual([]);
  });

  it("are empty for a place with none, which is not the same as unreadable", () => {
    expect(alertsIn("9502", alerts)).toEqual([]);
  });

  it("keep the order they came in, which is newest first", () => {
    const found = alertsIn("94", alerts);
    expect(found[0]!.id).toBe("a");
    expect(found[1]!.id).toBe("c");
  });
});
