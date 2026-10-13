import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertReview } from "@/components/admin/AlertReview";
import {
  alertReviewMessages,
  alertState,
  areaChoice,
  bangkokToIso,
  chosenTambons,
  lineQuotaAfter,
  toAdminAlert,
  toPreview,
  updateHours,
  windowOf,
} from "@/lib/alert-console";
import { reasonFor } from "@/lib/public-status";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const ALL = ["950101", "950102", "950201", "940101", "940102", "900101"];

describe("the area an alert names", () => {
  const pick = (c: Partial<ReturnType<typeof areaChoice>>) =>
    chosenTambons(ALL, { provinces: [], districts: [], tambons: [], zones: [], ...c });

  it("expands a whole province and a whole district by their code prefix", () => {
    expect(pick({ provinces: ["95"] })).toEqual(["950101", "950102", "950201"]);
    expect(pick({ districts: ["9401"] })).toEqual(["940101", "940102"]);
  });

  it("joins every way of choosing without counting a tambon twice", () => {
    expect(
      chosenTambons(
        ALL,
        { provinces: [], districts: ["9501"], tambons: ["950101", "900101"], zones: ["z"] },
        { z: ["950102", "940101"] },
      ),
    ).toEqual(["900101", "940101", "950101", "950102"]);
  });

  it("drops a code that is not a tambon Jaga has, and gives nothing for nothing", () => {
    expect(pick({ tambons: ["999999", "950201"] })).toEqual(["950201"]);
    expect(pick({})).toEqual([]);
    expect(pick({ zones: ["unknown"] })).toEqual([]);
  });

  it("reads the form's repeated fields", () => {
    const form = new FormData();
    form.append("province", "95");
    form.append("tambon", "900101");
    form.append("tambon", "");
    expect(areaChoice((name) => form.getAll(name))).toEqual({
      provinces: ["95"],
      districts: [],
      tambons: ["900101"],
      zones: [],
    });
  });
});

describe("times", () => {
  it("accepts only the offered waits for the next update", () => {
    expect(updateHours("3")).toBe(3);
    expect(updateHours("24")).toBe(24);
    expect(updateHours("5")).toBeNull();
    expect(updateHours("")).toBeNull();
    expect(updateHours(null)).toBeNull();
  });

  it("reads a typed time as Bangkok time, wherever the admin's laptop is", () => {
    expect(bangkokToIso("2026-11-20T06:00")).toBe("2026-11-19T23:00:00.000Z");
    expect(bangkokToIso("2026-11-20T06:00:30")).toBe("2026-11-19T23:00:00.000Z");
    expect(bangkokToIso("")).toBeNull();
    expect(bangkokToIso("20 Nov")).toBeNull();
  });

  it("wants both ends of a window, in order, or neither", () => {
    expect(windowOf("", "")).toEqual({ ok: true, range: null });
    expect(windowOf("2026-11-20T06:00", "")).toEqual({ ok: false, error: "half" });
    expect(windowOf("2026-11-20T18:00", "2026-11-20T06:00")).toEqual({
      ok: false,
      error: "order",
    });
    expect(windowOf("2026-11-20T06:00", "2026-11-20T18:00")).toEqual({
      ok: true,
      range: ["2026-11-19T23:00:00.000Z", "2026-11-20T11:00:00.000Z"],
    });
  });
});

describe("rows from the database", () => {
  const row = {
    alert_id: "a1",
    level: "warning",
    reason: "เหตุผล",
    messages: { th: "ไทย", ms: "Melayu", reason_ms: "Sebab", extra: 4 },
    issued_at: "2026-11-20T01:00:00Z",
    next_update_at: "2026-11-20T04:00:00Z",
    issued_by_name: "Admin A",
    is_drill: true,
    tambons: ["950101"],
    superseded_by: null,
    cancelled_at: null,
    events: [{ action: "alert_published", at: "2026-11-20T01:00:00Z", by: "Admin A" }],
  };

  it("become an alert, with its state and its history", () => {
    const a = toAdminAlert(row)!;
    expect(a.drill).toBe(true);
    expect(a.messages).toEqual({ th: "ไทย", ms: "Melayu", reason_ms: "Sebab" });
    expect(alertState(a)).toBe("inForce");
    expect(a.events[0]!.details).toEqual({});
    expect(alertState(toAdminAlert({ ...row, superseded_by: "b2" })!)).toBe("superseded");
    expect(alertState(toAdminAlert({ ...row, cancelled_at: "2026-11-20T02:00:00Z" })!)).toBe(
      "cancelled",
    );
  });

  it("are left out when a required part of an alert is missing (safety rule 3)", () => {
    expect(toAdminAlert({ ...row, next_update_at: null })).toBeNull();
    expect(toAdminAlert({ ...row, level: "purple" })).toBeNull();
  });

  it("show the reason in the reader's language when the alert carries one", () => {
    const a = toAdminAlert(row)!;
    expect(reasonFor(a, "ms")).toBe("Sebab");
    expect(reasonFor(a, "en")).toBe("เหตุผล");
    expect(reasonFor(a, "th")).toBe("เหตุผล");
  });
});

const PREVIEW = {
  level: "evacuate",
  reason: "น้ำกำลังจะท่วม",
  messages: { th: "อพยพทันที", ms: "Pindah segera", en: "Evacuate now" },
  tambons: 3,
  reach: { homes: 4, watched: 2, people: 5, push: 1, line: 3 },
  lineQuota: { used: 198, limit: 200 },
  overlaps: [{ id: "x", level: "watch", drill: false, shared: 1 }],
};

describe("the review's numbers", () => {
  it("warns when the LINE quota would be passed, and says nothing when it is not tracked", () => {
    expect(lineQuotaAfter(toPreview(PREVIEW)!)).toEqual({ after: 201, limit: 200, over: true });
    expect(lineQuotaAfter(toPreview({ ...PREVIEW, lineQuota: null })!)).toBeNull();
  });

  it("refuses a preview without Thai text", () => {
    expect(toPreview({ ...PREVIEW, messages: { en: "only" } })).toBeNull();
    expect(toPreview(null)).toBeNull();
  });
});

describe("the review step", () => {
  afterEach(() => vi.unstubAllGlobals());

  const form = (hours = "3") => (
    <form>
      <input type="radio" name="template" value="t1" defaultChecked />
      <input type="checkbox" name="tambon" value="950101" defaultChecked />
      <input name="note" defaultValue="" />
      <select name="hours" defaultValue={hours}>
        <option value="3">3</option>
        <option value="5">5</option>
      </select>
      <AlertReview />
    </form>
  );
  const answer = (body: unknown, ok = true) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok, json: async () => body })),
    );

  it("offers no publish button until the review has been read", async () => {
    answer({ preview: PREVIEW, launched: false });
    const { container } = renderWithIntl(form(), "en");
    expect(container.querySelector("[data-publish]")).toBeNull();
    fireEvent.click(container.querySelector("[data-review]")!);
    await waitFor(() => expect(container.querySelector("[data-publish]")).not.toBeNull());

    for (const locale of ["th", "ms", "en"]) {
      expect(container.querySelector(`[data-review-text="${locale}"]`)!.textContent).toContain(
        PREVIEW.messages[locale as "th"],
      );
    }
    expect(container.querySelector("[data-drill='true']")).not.toBeNull();
    expect(container.querySelector("[data-publish]")!.textContent).toBe("Save as a drill");
    expect(container.querySelector("[data-review-overlaps='1']")).not.toBeNull();
    expect(container.textContent).toContain("201 of 200");
  });

  it("asks for a second yes before an Evacuate, and only then", async () => {
    answer({ preview: PREVIEW, launched: true });
    const { container } = renderWithIntl(form(), "en");
    fireEvent.click(container.querySelector("[data-review]")!);
    await waitFor(() => expect(container.querySelector("[data-publish]")).not.toBeNull());
    const tick = container.querySelector<HTMLInputElement>("input[name='confirmEvacuate']")!;
    expect(tick.required).toBe(true);
    expect(tick.checked).toBe(false);
    expect(container.querySelector("[data-publish]")!.textContent).toBe("Publish the alert");

    // Ticking it does not throw the review away.
    fireEvent.click(tick);
    expect(container.querySelector("[data-publish]")).not.toBeNull();
  });

  it("starts on drill before launch, and a real alert is a choice made at the review", async () => {
    answer({ preview: { ...PREVIEW, level: "warning" }, launched: false });
    const { container } = renderWithIntl(form(), "en");
    fireEvent.click(container.querySelector("[data-review]")!);
    await waitFor(() => expect(container.querySelector("[data-publish]")).not.toBeNull());
    const real = container.querySelector<HTMLInputElement>("input[name='mode'][value='real']")!;
    expect(real.checked).toBe(false);
    expect(container.querySelector("[data-publish]")!.textContent).toBe("Save as a drill");
    fireEvent.click(real);
    // Choosing does not throw the review away, and the button says what will happen.
    expect(container.querySelector("[data-publish]")!.textContent).toBe("Publish the alert");
    expect(container.querySelector("[data-drill='false']")).not.toBeNull();
  });

  it("offers no choice once the service is on, nor when replacing an alert", async () => {
    answer({ preview: { ...PREVIEW, level: "warning" }, launched: true });
    const live = renderWithIntl(form(), "en");
    fireEvent.click(live.container.querySelector("[data-review]")!);
    await waitFor(() => expect(live.container.querySelector("[data-publish]")).not.toBeNull());
    expect(live.container.querySelector("input[type='radio'][name='mode']")).toBeNull();
    expect(
      live.container.querySelector<HTMLInputElement>("input[type='hidden'][name='mode']")!.value,
    ).toBe("real");
    live.unmount();

    answer({ preview: { ...PREVIEW, level: "warning" }, launched: false });
    const replacing = renderWithIntl(
      <form>
        <input type="radio" name="template" value="t1" defaultChecked />
        <select name="hours" defaultValue="3">
          <option value="3">3</option>
        </select>
        <AlertReview fixedMode="real" />
      </form>,
      "en",
    );
    fireEvent.click(replacing.container.querySelector("[data-review]")!);
    await waitFor(() => expect(replacing.container.querySelector("[data-publish]")).not.toBeNull());
    expect(replacing.container.querySelector("input[type='radio'][name='mode']")).toBeNull();
    expect(replacing.container.querySelector("[data-publish]")!.textContent).toBe(
      "Publish the alert",
    );
  });

  it("has no Evacuate tick on any other level", async () => {
    answer({ preview: { ...PREVIEW, level: "watch" }, launched: false });
    const { container } = renderWithIntl(form(), "en");
    fireEvent.click(container.querySelector("[data-review]")!);
    await waitFor(() => expect(container.querySelector("[data-publish]")).not.toBeNull());
    expect(container.querySelector("input[name='confirmEvacuate']")).toBeNull();
  });

  it("takes the publish button away again when the form changes", async () => {
    answer({ preview: PREVIEW, launched: false });
    const { container } = renderWithIntl(form(), "en");
    fireEvent.click(container.querySelector("[data-review]")!);
    await waitFor(() => expect(container.querySelector("[data-publish]")).not.toBeNull());
    fireEvent.click(container.querySelector("input[name='tambon']")!);
    await waitFor(() => expect(container.querySelector("[data-publish]")).toBeNull());
  });

  it("says so, and offers nothing to publish, when the review cannot be made", async () => {
    answer({ error: "area" }, false);
    const { container } = renderWithIntl(form(), "en");
    fireEvent.click(container.querySelector("[data-review]")!);
    await waitFor(() => expect(container.querySelector("[role='alert']")).not.toBeNull());
    expect(container.querySelector("[data-publish]")).toBeNull();
    expect(container.querySelector("[role='alert']")!.textContent).toBe(
      en.alertConsole.review.error.area,
    );
  });

  it("does not ask the server at all without a next-update time", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { container } = renderWithIntl(form("5"), "en");
    fireEvent.click(container.querySelector("[data-review]")!);
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")).not.toBeNull();
  });
});

describe("the console's words", () => {
  const keys = (o: unknown, at = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, at ? `${at}.${k}` : k))
      : [at];

  it("exist in all three languages, key for key", () => {
    expect(keys(ms.alertConsole)).toEqual(keys(th.alertConsole));
    expect(keys(en.alertConsole)).toEqual(keys(th.alertConsole));
  });

  it("sends the browser only the review's words and the level names", () => {
    const sent = alertReviewMessages(th) as Record<string, Record<string, unknown>>;
    expect(Object.keys(sent)).toEqual(["alertConsole", "alert"]);
    expect(Object.keys(sent.alertConsole!)).toEqual(["review"]);
    expect(Object.keys(sent.alert!)).toEqual(["level"]);
  });
});
