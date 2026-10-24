import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewPanel } from "@/components/authority/CrewPanel";
import { MyCases } from "@/components/authority/MyCases";
import type { CaseAssignment, CrewMember } from "@/lib/dispatch";
import type { FieldCase, MyWork } from "@/lib/field-crew";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const UNIT = "aaaaaaaa-0000-4000-8000-000000000001";
const SOS = "bbbbbbbb-0000-4000-8000-000000000002";

const owner: CrewMember = {
  unitId: UNIT,
  userId: "u1",
  name: "Owner",
  role: "owner",
  openCases: 0,
};
const boat: CrewMember = {
  unitId: UNIT,
  userId: "u2",
  name: "Boat one",
  role: "field",
  openCases: 1,
};
const boat2: CrewMember = {
  unitId: UNIT,
  userId: "u3",
  name: "Boat two",
  role: "field",
  openCases: 0,
};
const held: CaseAssignment = {
  id: "a1",
  sosId: SOS,
  userId: "u2",
  name: "Boat one",
  selfAssigned: false,
  assignedAt: "2026-10-24T03:00:00Z",
};

describe("the crew panel on a case", () => {
  it("says nothing when the owner is the only person and nobody holds the case", () => {
    const { container } = renderWithIntl(
      <CrewPanel
        crew={[owner]}
        assigned={[]}
        busy={false}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
      />,
      "en",
    );
    expect(container.querySelector("[data-crew]")).toBeNull();
  });

  it("offers only people not already on the case, and hands the case to the one picked", () => {
    const onAssign = vi.fn();
    const { container, getByText } = renderWithIntl(
      <CrewPanel
        crew={[owner, boat, boat2]}
        assigned={[held]}
        busy={false}
        onAssign={onAssign}
        onUnassign={vi.fn()}
      />,
      "en",
    );
    const options = Array.from(container.querySelectorAll("option")).map((o) => o.textContent);
    expect(options.some((o) => o?.includes("Boat one"))).toBe(false);
    expect(options.some((o) => o?.includes("Boat two"))).toBe(true);
    const assign = container.querySelector<HTMLButtonElement>("[data-assign]")!;
    expect(assign.disabled).toBe(true);
    fireEvent.change(container.querySelector("select")!, { target: { value: "u3" } });
    fireEvent.click(container.querySelector<HTMLButtonElement>("[data-assign]")!);
    expect(onAssign).toHaveBeenCalledWith("u3");
    expect(getByText("Boat one")).toBeTruthy();
  });

  it("takes a person off the case", () => {
    const onUnassign = vi.fn();
    const { container } = renderWithIntl(
      <CrewPanel
        crew={[owner, boat]}
        assigned={[held]}
        busy={false}
        onAssign={vi.fn()}
        onUnassign={onUnassign}
      />,
      "en",
    );
    fireEvent.click(container.querySelector("[data-unassign]")!);
    expect(onUnassign).toHaveBeenCalledWith("a1");
  });
});

const field: FieldCase = {
  sosId: SOS,
  assignmentId: "a1",
  status: "assigned",
  kind: "rescue",
  lat: 6.8782,
  lon: 101.2719,
  accuracyM: 12,
  locationText: "Behind the mosque",
  tambonTh: "บานา",
  tambonEn: "Bana",
  peopleCount: 3,
  vulnerableFlags: { elderly: true },
  depthRef: "waist",
  injuries: null,
  textNote: null,
  needs: [],
  needsNote: null,
  unitName: "Yala rescue",
  assignedAt: "2026-10-24T03:00:00Z",
  hasPhone: true,
  crewCount: 2,
};

const work = (over: Partial<MyWork> = {}): MyWork => ({
  cases: [],
  open: [],
  readAt: "2026-10-24T03:00:00Z",
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("a crew member's own screen", () => {
  it("says plainly when nothing is handed to them", () => {
    const { container } = renderWithIntl(<MyCases initial={work()} />, "en");
    expect(container.textContent).toContain(en.fieldCrew.none.title);
    expect(container.querySelector("[data-my-case]")).toBeNull();
  });

  it("shows the point, the flags and a navigate link, and hides the number until asked", () => {
    const { container } = renderWithIntl(<MyCases initial={work({ cases: [field] })} />, "en");
    expect(container.textContent).toContain("Bana");
    expect(container.textContent).toContain("6.87820, 101.27190");
    expect(container.querySelector<HTMLAnchorElement>("[data-navigate]")!.href).toContain(
      "destination=6.878200%2C101.271900",
    );
    expect(container.querySelector("[data-flags]")).not.toBeNull();
    expect(container.querySelector("[data-phone]")).toBeNull();
    expect(container.querySelector("[data-show-phone]")).not.toBeNull();
  });

  it("asks the server for the number only when tapped, then shows it as a call link", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ phone: "0811111111", work: work({ cases: [field] }) }), {
        status: 200,
      }),
    );
    const { container } = renderWithIntl(<MyCases initial={work({ cases: [field] })} />, "en");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector("[data-show-phone]")!);
    await waitFor(() => expect(container.querySelector("[data-phone]")).not.toBeNull());
    expect(container.querySelector<HTMLAnchorElement>("[data-phone] a")!.href).toBe(
      "tel:0811111111",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body).toEqual({ action: "phone", sos: SOS });
  });

  it("offers the next honest step: on the way, then arrived", () => {
    const first = renderWithIntl(<MyCases initial={work({ cases: [field] })} />, "en");
    expect(first.container.querySelector('[data-advance="en_route"]')).not.toBeNull();
    expect(first.container.querySelector('[data-advance="on_site"]')).toBeNull();
    first.unmount();
    const second = renderWithIntl(
      <MyCases initial={work({ cases: [{ ...field, status: "en_route" }] })} />,
      "en",
    );
    expect(second.container.querySelector('[data-advance="on_site"]')).not.toBeNull();
  });

  it("lets a member take a case the team holds", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ work: work() }), { status: 200 }));
    const open = {
      sosId: SOS,
      unitName: "Yala rescue",
      kind: "rescue" as const,
      status: "assigned",
      tambonTh: "บานา",
      tambonEn: "Bana",
      peopleCount: 3,
      crewCount: 0,
    };
    const { container } = renderWithIntl(<MyCases initial={work({ open: [open] })} />, "en");
    fireEvent.click(container.querySelector("[data-take]")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      action: "take",
      sos: SOS,
    });
  });
});

describe("the words", () => {
  it("every language has every line of the new pages", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    for (const ns of ["fieldCrew", "unitTeam"] as const) {
      const base = keys(th[ns]).sort();
      expect(keys(en[ns]).sort()).toEqual(base);
      expect(keys(ms[ns]).sort()).toEqual(base);
    }
    const crew = keys(th.authority.crew).sort();
    expect(keys(en.authority.crew).sort()).toEqual(crew);
    expect(keys(ms.authority.crew).sort()).toEqual(crew);
  });
});
