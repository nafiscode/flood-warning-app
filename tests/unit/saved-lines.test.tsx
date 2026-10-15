import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardView } from "@/components/map/DashboardView";
import { MyRequests, MyRequestsView } from "@/components/journey/MyRequests";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_NOW,
  exampleStatus,
} from "@/lib/dev-examples";
import type { UnitRequest } from "@/lib/journey";
import en from "@/messages/en.json";
import { renderWithIntl } from "./render";

// The real map needs WebGL; these tests are about the words around it.
vi.mock("@/components/map/MapView", () => ({ MapView: () => <div data-map="true" /> }));

const UNIT: UnitRequest = {
  id: "u1",
  name: "Bana boat team",
  status: "pending",
  createdAt: "2026-10-14T02:00:00Z",
  verifiedAt: null,
  updatedAt: null,
};

function map(props: { failed: boolean; checkedAt: number | null; dataServedAt?: number | null }) {
  return renderWithIntl(
    <DashboardView
      status={exampleStatus([])}
      hazards={EXAMPLE_HAZARDS}
      hazardsState="ok"
      directory={EXAMPLE_DIRECTORY}
      directoryState="ok"
      data={EXAMPLE_MAP}
      dataState="ok"
      now={EXAMPLE_NOW}
      transparency={false}
      area={BANA}
      {...props}
    />,
    "en",
  ).container;
}

describe("every saved thing says how old it is (A9)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.cookie = "sb-test-auth-token=; max-age=0; path=/";
  });

  it("the map says nothing while it is up to date", () => {
    const c = map({ failed: false, checkedAt: EXAMPLE_NOW - 60_000 });
    expect(c.querySelector("[data-map-saved]")).toBeNull();
  });

  it("without signal the map gives the older of the alert status and its own data", () => {
    const c = map({
      failed: true,
      checkedAt: EXAMPLE_NOW - 60_000,
      dataServedAt: EXAMPLE_NOW - 3 * 3_600_000,
    });
    const line = c.querySelector("[data-map-saved]")!;
    expect(line.getAttribute("data-map-saved")).toBe("time");
    expect(line.textContent).toContain(en.map.savedAt.split("{time}")[0]!);
  });

  it("without signal and nothing kept, the map still says it is the phone's copy", () => {
    const c = map({ failed: true, checkedAt: null });
    expect(c.querySelector("[data-map-saved]")!.textContent).toBe(en.map.savedOld);
  });

  it("My requests says when the copy it shows was saved", () => {
    const { container } = renderWithIntl(
      <MyRequestsView
        data={{
          cases: [],
          units: [UNIT],
          reports: [],
          signedIn: true,
          fromPhone: true,
          savedAt: EXAMPLE_NOW,
        }}
        loading={false}
      />,
      "en",
    );
    expect(
      container.querySelector("[data-requests-saved]")!.getAttribute("data-requests-saved"),
    ).toBe("time");
  });

  it("offline, My requests shows the teams it kept, with the line; online it keeps a new copy", async () => {
    document.cookie = "sb-test-auth-token=x; path=/";
    window.localStorage.setItem(
      "jaga.requests",
      JSON.stringify({ units: [UNIT], reports: [], field: [], savedAt: EXAMPLE_NOW }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const offline = renderWithIntl(<MyRequests />, "en").container;
    await waitFor(() => expect(offline.querySelector('[data-request="unit:u1"]')).not.toBeNull());
    expect(offline.querySelector("[data-requests-saved]")).not.toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.includes("report")
                ? { reports: [] }
                : url.includes("field")
                  ? { rescues: [] }
                  : { units: [] },
            ),
          ),
        ),
      ),
    );
    const online = renderWithIntl(<MyRequests />, "en").container;
    await waitFor(() => expect(online.querySelector("[data-requests-empty]")).not.toBeNull());
    expect(online.querySelector("[data-requests-saved]")).toBeNull();
    const kept = JSON.parse(window.localStorage.getItem("jaga.requests")!);
    expect(kept.units).toEqual([]);
  });

  it("a visitor's phone keeps no copy", async () => {
    window.localStorage.setItem(
      "jaga.requests",
      JSON.stringify({ units: [UNIT], reports: [], field: [], savedAt: EXAMPLE_NOW }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    const c = renderWithIntl(<MyRequests />, "en").container;
    await waitFor(() => expect(c.querySelector("[data-requests-empty]")).not.toBeNull());
    expect(window.localStorage.getItem("jaga.requests")).toBeNull();
  });
});
