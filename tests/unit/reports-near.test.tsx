import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeView, type HomeViewProps } from "@/components/home/HomeView";
import { MyReportsView } from "@/components/reports/MyReports";
import { ReportsNear, reportsMapHref } from "@/components/reports/ReportsNear";
import {
  BANA,
  EXAMPLE_MY_REPORTS,
  EXAMPLE_NOW,
  EXAMPLE_PLACES,
  EXAMPLE_REPORTS_NEAR,
  homeExample,
} from "@/lib/dev-examples";
import {
  reportsNearMe,
  toMyReport,
  toTambonReports,
  type TambonReports,
} from "@/lib/flood-reports";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const [BANA_REPORTS, SABARANG] = EXAMPLE_REPORTS_NEAR as [TambonReports, TambonReports];
const elsewhere: TambonReports = { ...SABARANG, tambon: "950101", district: "9501" };

describe("which reports concern someone", () => {
  it("their own tambons first, then the rest of the same district, and nothing further away", () => {
    const near = reportsNearMe([SABARANG, elsewhere, BANA_REPORTS], [BANA.code]);
    expect(near.here.map((r) => r.tambon)).toEqual([BANA.code]);
    expect(near.district.map((r) => r.tambon)).toEqual(["940101"]);
  });

  it("a watched place's district counts like the home one", () => {
    const near = reportsNearMe([elsewhere], [BANA.code, "950102"]);
    expect(near.here).toEqual([]);
    expect(near.district.map((r) => r.tambon)).toEqual(["950101"]);
  });

  it("someone who has not said where they are is shown nothing", () => {
    expect(reportsNearMe(EXAMPLE_REPORTS_NEAR, [])).toEqual({ here: [], district: [] });
  });
});

describe("reading the database's rows", () => {
  it("keeps the counts and drops a row that is not what was promised", () => {
    const row = {
      tambon: "940104",
      name_th: "บานา",
      name_en: "Bana",
      district: "9401",
      district_th: "เมืองปัตตานี",
      district_en: "Mueang Pattani",
      lat: 6.87,
      lon: 101.27,
      reports: 2,
      people: 2,
      deepest: "knee",
      worst_road: "impassable",
      latest_trend: "rising",
      first_at: "2026-11-20T07:00:00Z",
      latest_at: "2026-11-20T09:00:00Z",
      confirmed: false,
    };
    expect(toTambonReports(row)).toMatchObject({
      reports: 2,
      deepest: "knee",
      worstRoad: "impassable",
    });
    expect(toTambonReports({ ...row, tambon: "94" })).toBeNull();
    expect(toTambonReports({ ...row, reports: 0 })).toBeNull();
    // A depth the app does not know is left out, not printed.
    expect(toTambonReports({ ...row, deepest: "ocean" })!.deepest).toBeNull();
    expect(toMyReport({ id: "x", state: "standing", depth_ref: "knee" })!.state).toBe("standing");
    expect(toMyReport({ id: "x", state: "weird" })).toBeNull();
  });
});

describe("the banner", () => {
  const near = reportsNearMe(EXAMPLE_REPORTS_NEAR, [BANA.code]);

  it("says who is speaking, and wears no alert colour or level", () => {
    const { container } = renderWithIntl(<ReportsNear near={near} />);
    const banner = container.querySelector("[data-reports-near]")!;
    expect(banner.getAttribute("data-reports-near")).toBe("here");
    expect(banner.textContent).toContain(th.reportsNear.title);
    expect(banner.textContent).toContain(th.reportsNear.source);
    expect(container.innerHTML).not.toMatch(/alert-|bg-sos|data-level/);
  });

  it("says in words how far each tambon's reports can be trusted", () => {
    const { container } = renderWithIntl(<ReportsNear near={near} />);
    const rows = [...container.querySelectorAll("[data-reports-tambon]")];
    expect(rows.map((r) => r.getAttribute("data-reports-confirmed"))).toEqual(["true", "false"]);
    expect(rows[0]!.textContent).toContain(th.reportsNear.confirmed);
    expect(rows[0]!.textContent).toContain(th.report.depths.waist);
    expect(rows[1]!.textContent).toContain(th.reportsNear.unconfirmed);
  });

  it("each tambon links to the map on that tambon's own point", () => {
    expect(reportsMapHref(BANA_REPORTS).query.reports).toBe(BANA.code);
    const { container } = renderWithIntl(<ReportsNear near={near} />);
    const href = container.querySelector("[data-reports-tambon] a")!.getAttribute("href")!;
    expect(href).toContain(`reports=${BANA.code}`);
    expect(href).toContain("at=");
  });

  it("draws nothing at all when there is nothing to say", () => {
    const { container } = renderWithIntl(<ReportsNear near={{ here: [], district: [] }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("on the home screen", () => {
  const home = (more: Partial<HomeViewProps>) => {
    const example = homeExample("normal");
    return renderWithIntl(
      <HomeView
        ready
        status={example.status}
        checkedAt={EXAMPLE_NOW - 60_000}
        failed={false}
        area={BANA}
        me={example.me}
        places={EXAMPLE_PLACES}
        placesState="ok"
        now={EXAMPLE_NOW}
        onChooseArea={() => {}}
        onRetry={() => {}}
        projectLine={null}
        {...more}
      />,
    ).container;
  };

  it("sits under the hero, which still says the tambon's own level", () => {
    const c = home({ reports: EXAMPLE_REPORTS_NEAR });
    const hero = c.querySelector("[data-hero]")!;
    const banner = c.querySelector("[data-reports-near]")!;
    expect(hero.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero.getAttribute("data-hero")).toBe("normal");
  });

  it("is not there for someone in another district, or while reports could not be read", () => {
    expect(home({ reports: [elsewhere] }).querySelector("[data-reports-near]")).toBeNull();
    expect(home({ reports: null }).querySelector("[data-reports-near]")).toBeNull();
  });
});

describe("the reporter's own reports", () => {
  it("a standing report says it stands and offers the button that ends it", () => {
    const onEnd = vi.fn();
    const { container } = renderWithIntl(
      <MyReportsView reports={EXAMPLE_MY_REPORTS} busy={null} failed={false} onEnd={onEnd} />,
    );
    const item = container.querySelector("[data-my-report='standing']")!;
    expect(item.textContent).toContain(th.reportsNear.mine.standing);
    fireEvent.click(item.querySelector("button")!);
    expect(onEnd).toHaveBeenCalledWith(EXAMPLE_MY_REPORTS[0]!.id);
  });

  it("an ended or cleared report says why, and has no button", () => {
    for (const state of ["ended", "cleared", "expired", "hidden"] as const) {
      const { container } = renderWithIntl(
        <MyReportsView
          reports={[{ ...EXAMPLE_MY_REPORTS[0]!, state }]}
          busy={null}
          failed={false}
          onEnd={() => {}}
        />,
      );
      expect(container.textContent).toContain(th.reportsNear.mine[state]);
      expect(container.querySelector("button")).toBeNull();
    }
  });
});
