import { describe, expect, it } from "vitest";
import { parseNotice } from "@/lib/status-notice";

describe("parseNotice", () => {
  it("treats an empty file as nothing to say", () => {
    expect(parseNotice({}, "th")).toEqual({ level: "ok", since: null, message: null });
  });

  it("treats a missing or non-object file as nothing to say", () => {
    expect(parseNotice(null, "th").level).toBe("ok");
    expect(parseNotice("down", "th").level).toBe("ok");
    expect(parseNotice(42, "th").level).toBe("ok");
  });

  it("ignores an unknown level (never cries wolf on a typo)", () => {
    expect(parseNotice({ level: "broken", message: { th: "x" } }, "th").level).toBe("ok");
  });

  it("reads a down note in the reader's language", () => {
    const s = parseNotice(
      { level: "down", since: "2026-11-07T10:00:00Z", message: { th: "ไทย", en: "english" } },
      "en",
    );
    expect(s).toEqual({ level: "down", since: "2026-11-07T10:00:00Z", message: "english" });
  });

  it("falls back to Thai, then English, when the reader's language is missing", () => {
    expect(parseNotice({ level: "degraded", message: { th: "ไทย" } }, "ms").message).toBe("ไทย");
    expect(parseNotice({ level: "degraded", message: { en: "english" } }, "ms").message).toBe(
      "english",
    );
  });

  it("keeps a posted level even with no readable message", () => {
    const s = parseNotice({ level: "down" }, "th");
    expect(s.level).toBe("down");
    expect(s.message).toBeNull();
  });

  it("drops a blank or non-string since", () => {
    expect(parseNotice({ level: "down", since: 123, message: { th: "x" } }, "th").since).toBeNull();
  });
});
