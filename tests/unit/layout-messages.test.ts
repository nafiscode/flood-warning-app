import { describe, expect, it } from "vitest";
import { layoutMessages } from "@/lib/messages";
import th from "@/messages/th.json";
import ms from "@/messages/ms.json";
import en from "@/messages/en.json";

/**
 * The bell is drawn by the layout, so whatever it opens reads only the layout's messages. The flood
 * scene a bank-reached notice opens printed its key paths ("map.gauge.scene.title") on the owner's
 * phone (28 Nov 2026) because its group was not sent.
 */
describe("layoutMessages", () => {
  const keys = ["eyebrow", "title", "over", "level", "at", "notAlert", "hotlineHint", "replay", "close", "loading", "unavailable"];
  for (const [locale, all] of Object.entries({ th, ms, en })) {
    it(`carries the bell's flood scene words (${locale})`, () => {
      const m = layoutMessages(all) as { map: { gauge: { scene: Record<string, string> } } };
      for (const k of keys) expect(typeof m.map.gauge.scene[k], k).toBe("string");
    });
  }
});
