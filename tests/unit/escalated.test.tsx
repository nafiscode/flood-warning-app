import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EscalatedCases } from "@/components/authority/EscalatedCases";
import { sortEscalated, toEscalated, type EscalatedCase } from "@/lib/escalated";
import en from "@/messages/en.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const c = (more: Partial<EscalatedCase> = {}): EscalatedCase => ({
  sosId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-11-27T08:00:00Z",
  waitingMinutes: 75,
  lat: 6.54321,
  lon: 101.28123,
  accuracyM: 24,
  locationText: null,
  tambon: "950101",
  tambonTh: "สะเตง",
  tambonEn: "Sateng",
  districtTh: "เมืองยะลา",
  provinceTh: "ยะลา",
  peopleCount: 3,
  vulnerableFlags: { elderly: true },
  depth: "waist",
  injuries: null,
  note: "น้ำขึ้นถึงชั้นสอง",
  hasPhone: true,
  onBehalf: false,
  ...more,
});

describe("a case opened to every team, as the database gives it", () => {
  it("is shaped without any phone number, name or account", () => {
    const shaped = toEscalated({
      sos_id: "abc",
      created_at: "2026-11-27T08:00:00Z",
      waiting_minutes: 41,
      lat: 6.5,
      lon: 101.2,
      has_phone: true,
      contact_phone: "0811111111",
      requester_id: "u1",
    });
    expect(shaped.waitingMinutes).toBe(41);
    expect(JSON.stringify(shaped)).not.toContain("0811111111");
    expect(JSON.stringify(shaped)).not.toContain("u1");
    expect(shaped.hasPhone).toBe(true);
  });

  it("is read longest wait first", () => {
    const order = sortEscalated([
      c({ sosId: "a", waitingMinutes: 40 }),
      c({ sosId: "b", waitingMinutes: 200 }),
      c({ sosId: "c", waitingMinutes: 90 }),
    ]).map((x) => x.sosId);
    expect(order).toEqual(["b", "c", "a"]);
  });
});

describe("the list on a rescue team's console", () => {
  const show = (cases: EscalatedCase[], phones: Record<string, string | null> = {}) => {
    const onPhone = vi.fn();
    const view = renderWithIntl(
      <EscalatedCases cases={cases} phones={phones} busy={null} onPhone={onPhone} />,
    );
    return { ...view, onPhone };
  };

  it("draws nothing when no case is open to other teams", () => {
    expect(show([]).container.innerHTML).toBe("");
  });

  it("gives the place, how long, the point and a way there, and says it is not assigned", () => {
    const { container, getByText } = show([c()]);
    expect(getByText(th.authority.escalated.badge)).toBeTruthy();
    expect(container.textContent).toContain("สะเตง");
    expect(container.textContent).toContain("1 ชม. 15 น.");
    expect(container.textContent).toContain("3 คน");
    expect(container.textContent).toContain("6.54321");
    expect(container.querySelector("a[href*='6.54321']")).toBeTruthy();
    expect(container.textContent).toContain(th.authority.escalated.note.slice(0, 20));
  });

  it("shows no number until it is asked for, then asks once and shows what comes back", () => {
    const first = show([c()]);
    expect(first.container.querySelector("a[href^='tel:']")).toBeNull();
    fireEvent.click(first.getByText(th.authority.escalated.showPhone));
    expect(first.onPhone).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");

    const after = show([c()], { "11111111-1111-4111-8111-111111111111": "0811111111" });
    expect(after.container.querySelector("a[href='tel:0811111111']")).toBeTruthy();
    expect(after.container.textContent).toContain(th.authority.escalated.phoneLogged);
    expect(after.container.textContent).not.toContain(th.authority.escalated.showPhone);
  });

  it("says so when the sender gave no number, without a button that leads nowhere", () => {
    const { container, getAllByText } = show([c({ hasPhone: false })]);
    expect(container.textContent).not.toContain(th.authority.escalated.showPhone);
    expect(getAllByText(th.authority.escalated.phoneNone).length).toBeGreaterThan(0);
  });

  it("reads in English with the Latin spelling of the tambon", () => {
    const { container } = renderWithIntl(
      <EscalatedCases cases={[c()]} phones={{}} busy={null} onPhone={() => {}} />,
      "en",
    );
    expect(container.textContent).toContain("Sateng");
    expect(container.textContent).toContain(en.authority.escalated.badge);
  });
});
