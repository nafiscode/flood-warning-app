import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamEntryCard, TeamEntryChip } from "@/components/authority/TeamEntry";
import { JoinJaga } from "@/components/home/JoinJaga";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The home block asks whether a visitor is signed in; nothing here needs a network.
vi.mock("@/components/account/SignInOffer", () => ({
  SignInOffer: () => <div data-sign-in-offer />,
}));

const keep = (team: string | null, unit = false) => {
  window.localStorage.clear();
  if (team) window.localStorage.setItem("jaga.team", JSON.stringify(team));
  if (unit) window.localStorage.setItem("jaga.unit", "true");
};

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe("the way back into an approved team's board", () => {
  it("draws nothing for a visitor, a resident or a team still waiting to be approved", () => {
    keep(null);
    expect(
      renderWithIntl(<TeamEntryCard />, "en").container.querySelector("[data-team-entry]"),
    ).toBeNull();
    expect(
      renderWithIntl(<TeamEntryChip />, "en").container.querySelector("[data-team-entry]"),
    ).toBeNull();
    // Registered but not approved: they have a unit, and still no team entry.
    keep(null, true);
    expect(
      renderWithIntl(<TeamEntryCard />, "en").container.querySelector("[data-team-entry]"),
    ).toBeNull();
  });

  it("sends an owner or dispatcher to the board, and crew to the cases handed to them", () => {
    keep("board");
    const board = renderWithIntl(<TeamEntryCard />, "en");
    expect(board.container.querySelector("[data-team-open]")!.getAttribute("href")).toMatch(
      /\/authority$/,
    );
    expect(board.container.textContent).toContain(en.unitWay.teamOpen);
    board.unmount();
    keep("mine");
    const mine = renderWithIntl(<TeamEntryCard />, "en");
    expect(mine.container.querySelector("[data-team-open]")!.getAttribute("href")).toMatch(
      /\/authority\/mine$/,
    );
    expect(mine.container.textContent).toContain(en.unitWay.teamOpenMine);
  });

  it("is one small pill on the map, with the same destinations", () => {
    keep("board");
    const chip = renderWithIntl(<TeamEntryChip />, "en").container.querySelector(
      "[data-team-entry='chip']",
    )!;
    expect(chip.getAttribute("href")).toMatch(/\/authority$/);
    expect(chip.textContent).toBe(en.unitWay.teamChip);
  });
});

describe("the home screen for a team", () => {
  it("shows an approved team its way back, and no invitation to register", () => {
    keep("board", true);
    const { container } = renderWithIntl(<JoinJaga />, "en");
    expect(container.querySelector("[data-team-entry='card']")).not.toBeNull();
    expect(container.querySelector("[data-unit-way]")).toBeNull();
    expect(container.querySelector("[data-unit-register]")).toBeNull();
  });

  it("shows the same card in the laptop's action column", () => {
    keep("board", true);
    const { container } = renderWithIntl(<JoinJaga place="act" />, "en");
    expect(
      container.querySelector("[data-join-jaga-act='team'] [data-team-entry='card']"),
    ).not.toBeNull();
  });

  it("keeps the quiet line to the status of a registration still waiting", () => {
    keep(null, true);
    const { container } = renderWithIntl(<JoinJaga />, "en");
    expect(container.querySelector("[data-team-entry]")).toBeNull();
    expect(container.querySelector("[data-unit-way='line-home']")).not.toBeNull();
  });

  it("still invites a team that has not registered", () => {
    keep(null, false);
    const { container } = renderWithIntl(<JoinJaga />, "en");
    expect(container.querySelector("[data-unit-way='card']")).not.toBeNull();
    expect(container.querySelector("[data-team-entry]")).toBeNull();
  });
});

describe("the words", () => {
  it("every language has every new line", () => {
    const base = Object.keys(th.unitWay).sort();
    expect(Object.keys(en.unitWay).sort()).toEqual(base);
    expect(Object.keys(ms.unitWay).sort()).toEqual(base);
    expect(th.authority.war.sharingShort).toBeTruthy();
    expect(ms.authority.war.sharingShort).toBeTruthy();
  });
});
