import { render } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { PlanWatch } from "@/components/admin/PlanWatch";
import type { PlanHealth, StoredReading } from "@/lib/admin-plans";
import { adviseService, PLAN_SERVICES } from "@/lib/plan-limits";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

const ALL = { th, ms, en } as const;

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: keyof typeof ALL; namespace: string }) =>
    createTranslator({ locale, messages: ALL[locale] as never, namespace: namespace as never }),
}));
vi.mock("@/app/[locale]/admin/plans/actions", () => ({
  addReading: async () => {},
  deleteReading: async () => {},
}));

const NOW = new Date("2026-11-27T12:00:00Z");

const readings: StoredReading[] = [
  {
    id: 1,
    service: "vercel",
    meter: "active_cpu",
    value: 3,
    at: "2026-11-27T09:00:00Z",
    resetsOn: null,
    note: "email",
    byMe: true,
  },
  {
    id: 2,
    service: "supabase",
    meter: "disk_io",
    value: 1,
    at: "2026-11-27T09:00:00Z",
    resetsOn: null,
    note: null,
    byMe: false,
  },
  {
    id: 3,
    service: "supabase",
    meter: "db_size",
    value: 71,
    at: "2026-10-24T09:00:00Z",
    resetsOn: null,
    note: null,
    byMe: false,
  },
  {
    id: 4,
    service: "supabase",
    meter: "db_size",
    value: 80,
    at: "2026-11-26T19:10:00Z",
    resetsOn: null,
    note: "nightly snapshot",
    byMe: false,
    auto: true,
  },
];

const health: PlanHealth = {
  at: "2026-11-27T12:00:00Z",
  dbBytes: 82_000_000,
  storageBytes: 5_000_000,
  statsReset: "2026-11-20T00:00:00Z",
  cacheHit: 0.9987,
  connections: 14,
  authUsers: 120,
  writers: [{ table: "observations", writes: 120_000, dead: 900, live: 50_000, bytes: 9_000_000 }],
  crons: [{ name: "jaga-push-tick", schedule: "* * * * *", active: true, runs: 1440, failed: 0 }],
  cronLog: { rows: 90_000, bytes: 30_000_000 },
  io: null,
};

async function page(locale: keyof typeof ALL, health_: PlanHealth | null) {
  const advice = PLAN_SERVICES.map((s) => adviseService(s, readings, NOW));
  const ui = await PlanWatch({
    locale,
    advice,
    readings,
    health: health_,
    now: NOW,
    notices: { saved: false, removed: false, error: null },
  });
  return render(ui);
}

describe("the free-plan page", () => {
  it.each(["th", "ms", "en"] as const)(
    "draws both services, the form and the history in %s",
    async (locale) => {
      const { container } = await page(locale, health);
      expect(container.querySelector("[data-service=vercel]")?.getAttribute("data-verdict")).toBe(
        "now",
      );
      // The provider's own warning counts as an upgrade line for Supabase.
      expect(container.querySelector("[data-service=supabase]")?.getAttribute("data-verdict")).toBe(
        "now",
      );
      expect(container.querySelector("#add")).not.toBeNull();
      expect(container.querySelectorAll("[data-history] li")).toHaveLength(3);
      expect(container.querySelector("[data-health=ok]")).not.toBeNull();
      // No message key shown raw: next-intl prints the path when one is missing.
      expect(container.textContent).not.toMatch(/plans\.[a-z]/);
    },
  );

  it("says in words and a picture what to do, not by colour alone", async () => {
    const { container } = await page("en", health);
    const text = container.querySelector("[data-service=vercel] [data-verdict-text]");
    expect(text?.textContent).toBe("Upgrade now");
    expect(text?.querySelector("svg")).not.toBeNull();
  });

  it("opens, and says what it is waiting for, when the database cannot be asked yet", async () => {
    const { container } = await page("en", null);
    expect(container.querySelector("[data-health=missing]")).not.toBeNull();
  });

  it("only offers Remove on a reading the signed-in admin typed", async () => {
    const { container } = await page("en", health);
    const buttons = container.querySelectorAll("[data-history] form button");
    expect(buttons).toHaveLength(1);
  });
});
