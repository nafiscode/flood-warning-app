import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardView } from "@/components/authority/BoardView";
import type { CaseActions } from "@/components/authority/CaseCard";
import { MediaView } from "@/components/authority/Finish";
import { TeamStatus } from "@/components/sos/TeamStatus";
import { EXAMPLE_AUTHORITY_BOARD, EXAMPLE_NOW, applyExample } from "@/lib/authority-examples";
import {
  canReportRescue,
  caseState,
  clockText,
  filterCases,
  hoursSince,
  needsEta,
  nextStep,
  shouldAlarm,
  sortCases,
  tambonsOnBoard,
  type AuthorityBoard,
} from "@/lib/dispatch";
import { soundForChange, type SosTeam } from "@/lib/sos";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const OFFERED = "11111111-0000-4000-8000-000000000001";
const UNANSWERED = "22222222-0000-4000-8000-000000000002";
const MINE = "44444444-0000-4000-8000-000000000004";
const THEIRS = "55555555-0000-4000-8000-000000000005";
const CLOSED = "66666666-0000-4000-8000-000000000006";
const UNCONFIRMED = "77777777-0000-4000-8000-000000000007";

function actions(): CaseActions {
  return {
    accept: vi.fn(),
    decline: vi.fn(),
    eta: vi.fn(),
    advance: vi.fn(),
    release: vi.fn(),
    phone: vi.fn(),
    complete: vi.fn(),
    confirm: vi.fn(),
    media: vi.fn(),
    assign: vi.fn(),
    unassign: vi.fn(),
  };
}

function draw(
  board: AuthorityBoard = EXAMPLE_AUTHORITY_BOARD,
  more: Partial<Parameters<typeof BoardView>[0]> = {},
) {
  const taps = actions();
  const unit = { duty: vi.fn(), sharing: vi.fn() };
  renderWithIntl(
    <BoardView
      board={board}
      now={EXAMPLE_NOW}
      alarm="off"
      onArm={() => {}}
      busy={null}
      notice={null}
      phones={{}}
      media={{}}
      stale={false}
      onRefresh={null}
      actions={taps}
      unitActions={unit}
      {...more}
    />,
  );
  return { taps, unit };
}

const card = (id: string) => document.querySelector(`[data-case="${id}"]`)!;

describe("the console's arithmetic", () => {
  const byId = (id: string) => EXAMPLE_AUTHORITY_BOARD.cases.find((c) => c.sosId === id)!;

  it("reports on the way, then arrived, and nothing after that", () => {
    expect(nextStep({ ...byId(MINE), status: "assigned" })).toBe("en_route");
    expect(nextStep(byId(MINE))).toBe("on_site");
    expect(nextStep({ ...byId(MINE), status: "on_site" })).toBeNull();
    // Somebody else's case is not this team's to move on.
    expect(nextStep(byId(THEIRS))).toBeNull();
  });

  it("keeps asking for the estimate until one is given, and only of the team that holds it", () => {
    expect(needsEta(byId(MINE))).toBe(false);
    expect(needsEta({ ...byId(MINE), etaBand: null })).toBe(true);
    expect(needsEta(byId(OFFERED))).toBe(false);
  });

  it("writes the countdown as minutes and seconds", () => {
    expect(clockText(65)).toBe("1:05");
    expect(clockText(42)).toBe("0:42");
    expect(clockText(-3)).toBe("0:00");
  });

  it("filters by open or closed, by tambon and by vulnerable people", () => {
    const all = EXAMPLE_AUTHORITY_BOARD.cases;
    const open = filterCases(all, { scope: "open", tambon: null, vulnerableOnly: false });
    expect(open.every((c) => caseState(c) !== "closed")).toBe(true);
    // A rescue nobody has confirmed is still open work, not history. One is a supply request.
    expect(open.length).toBe(7);
    expect(filterCases(all, { scope: "closed", tambon: null, vulnerableOnly: false }).length).toBe(
      1,
    );
    expect(
      filterCases(all, { scope: "open", tambon: "940111", vulnerableOnly: false }).map(
        (c) => c.sosId,
      ),
    ).toEqual([UNANSWERED, MINE, UNCONFIRMED]);
    expect(filterCases(all, { scope: "open", tambon: null, vulnerableOnly: true }).length).toBe(4);
    expect(tambonsOnBoard(all).map((t) => t.code)).toEqual(["940104", "940111"]);
  });

  it("the example answers taps the way the database would", () => {
    const accepted = applyExample(
      EXAMPLE_AUTHORITY_BOARD,
      { action: "accept", sos: OFFERED },
      EXAMPLE_NOW,
    );
    const mine = accepted.cases.find((c) => c.sosId === OFFERED)!;
    expect(caseState(mine)).toBe("mine");
    expect(needsEta(mine)).toBe(true);
    // The alarm has nothing left to ring for.
    expect(shouldAlarm(accepted.cases, EXAMPLE_NOW)).toBe(false);
    // A case another team holds cannot be taken from it.
    const same = applyExample(accepted, { action: "accept", sos: THEIRS }, EXAMPLE_NOW);
    expect(caseState(same.cases.find((c) => c.sosId === THEIRS)!)).toBe("held_by_other");
    const back = applyExample(
      accepted,
      { action: "release", sos: OFFERED, reason: "no_boat" },
      EXAMPLE_NOW,
    );
    expect(caseState(back.cases.find((c) => c.sosId === OFFERED)!)).toBe("unanswered");
  });
});

describe("finishing a case", () => {
  const byId = (id: string) => EXAMPLE_AUTHORITY_BOARD.cases.find((c) => c.sosId === id)!;
  const photo = () => new File(["x"], "rescue.jpg", { type: "image/jpeg" });
  const choose = (root: Element, files: File[]) =>
    fireEvent.change(root.querySelector("[data-finish-photos]")!, { target: { files } });

  it("a reported rescue is not closed until somebody confirms it", () => {
    expect(caseState(byId(UNCONFIRMED))).toBe("awaiting");
    expect(caseState(byId(CLOSED))).toBe("closed");
    expect(hoursSince(byId(UNCONFIRMED).completedAt, EXAMPLE_NOW)).toBe(13);
  });

  it("a rescue this team may confirm rises above the cases already in hand", () => {
    const order = sortCases(EXAMPLE_AUTHORITY_BOARD.cases).map((c) => c.sosId);
    expect(order.indexOf(UNCONFIRMED)).toBeLessThan(order.indexOf(MINE));
    expect(order.indexOf(UNCONFIRMED)).toBeGreaterThan(order.indexOf(UNANSWERED));
  });

  it("only the team holding an open case can report its rescue", () => {
    expect(canReportRescue(byId(MINE))).toBe(true);
    expect(canReportRescue(byId(THEIRS))).toBe(false);
    expect(canReportRescue(byId(OFFERED))).toBe(false);
    expect(canReportRescue({ ...byId(MINE), status: "rescued" })).toBe(false);
  });

  it("reporting a rescue needs a photo, and the note is never required", () => {
    const { taps } = draw();
    const mine = card(MINE);
    fireEvent.click(mine.querySelector("[data-complete]")!);
    const send = mine.querySelector<HTMLButtonElement>("[data-finish-send]")!;
    expect(send.disabled).toBe(true);
    expect(mine.textContent).toContain(th.authority.finish.needPhoto);
    const file = photo();
    choose(mine, [file]);
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(taps.complete).toHaveBeenCalledWith(MINE, [file], "");
  });

  it("after the report the card waits for the person, and offers the team nothing to confirm", () => {
    const reported = applyExample(
      EXAMPLE_AUTHORITY_BOARD,
      { action: "complete", sos: MINE, photos: 1 },
      EXAMPLE_NOW,
    );
    draw(reported);
    const mine = card(MINE);
    expect(mine.getAttribute("data-case-state")).toBe("awaiting");
    expect(mine.textContent).toContain(th.authority.finish.awaiting.mine);
    expect(mine.querySelector("[data-confirm]")).toBeNull();
    expect(mine.querySelector("[data-complete]")).toBeNull();
    // Over for the crew: nothing to navigate to, no number to look up.
    expect(mine.querySelector("[data-navigate]")).toBeNull();
    expect(mine.querySelector("[data-show-phone]")).toBeNull();
  });

  it("the fallback needs a photo and a note, both", () => {
    const { taps } = draw();
    const waiting = card(UNCONFIRMED);
    expect(waiting.querySelector("[data-awaiting]")?.getAttribute("data-awaiting")).toBe("confirm");
    fireEvent.click(waiting.querySelector("[data-confirm]")!);
    const send = waiting.querySelector<HTMLButtonElement>("[data-finish-send]")!;
    const file = photo();
    choose(waiting, [file]);
    expect(send.disabled).toBe(true);
    fireEvent.change(waiting.querySelector("[data-finish-note]")!, {
      target: { value: "พบที่ศูนย์พักพิง" },
    });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(taps.confirm).toHaveBeenCalledWith(UNCONFIRMED, [file], "พบที่ศูนย์พักพิง");
  });

  it("photos are asked for by a tap, and shown from links, never from the board", () => {
    const { taps } = draw();
    expect(document.querySelectorAll("[data-case] img").length).toBe(0);
    fireEvent.click(card(UNCONFIRMED).querySelector("[data-show-media]")!);
    expect(taps.media).toHaveBeenCalledWith(UNCONFIRMED);
    document.body.innerHTML = "";
    renderWithIntl(
      <MediaView
        media={{
          photos: ["https://example.invalid/a"],
          voice: "https://example.invalid/v",
          proof: ["https://example.invalid/p1", "https://example.invalid/p2"],
        }}
      />,
    );
    expect(document.querySelectorAll("img").length).toBe(3);
    expect(document.querySelector("audio")).not.toBeNull();
    expect(document.body.textContent).toContain(th.authority.media.proof);
  });
});

describe("the board a team sees", () => {
  it("puts the offered case first, with its countdown and one tap to accept", () => {
    const { taps } = draw();
    const first = document.querySelector("[data-case]")!;
    expect(first.getAttribute("data-case")).toBe(OFFERED);
    expect(first.getAttribute("data-case-state")).toBe("offered_to_me");
    expect(first.textContent).toContain(th.authority.state.offered_to_me);
    expect(first.querySelector("[data-countdown]")?.textContent).toContain("0:42");
    fireEvent.click(first.querySelector("[data-accept]")!);
    expect(taps.accept).toHaveBeenCalledWith(OFFERED);
    // The offer is said in words too: sound is never the only channel.
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("1");
  });

  it("never carries a phone number: one is shown after a tap, for one case", () => {
    const { taps } = draw();
    expect(document.querySelectorAll('[data-case] a[href^="tel:"]').length).toBe(0);
    fireEvent.click(card(MINE).querySelector("[data-show-phone]")!);
    expect(taps.phone).toHaveBeenCalledWith(MINE);
  });

  it("shows a number once it was asked for, and says the look is logged", () => {
    draw(EXAMPLE_AUTHORITY_BOARD, { phones: { [MINE]: "0812345678" } });
    const shown = card(MINE).querySelector('[data-phone="shown"]')!;
    expect(shown.querySelector('a[href="tel:0812345678"]')).not.toBeNull();
    expect(shown.textContent).toContain(th.authority.act.phoneLogged);
    expect(card(OFFERED).querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("declining takes a reason from a short list, never typing", () => {
    const { taps } = draw();
    const offered = card(OFFERED);
    expect(offered.querySelector("[data-decline-reason]")).toBeNull();
    fireEvent.click(offered.querySelector("[data-decline]")!);
    expect(offered.querySelectorAll("[data-decline-reason]").length).toBe(4);
    expect(offered.querySelector("input, textarea")).toBeNull();
    fireEvent.click(offered.querySelector('[data-decline-reason="no_boat"]')!);
    expect(taps.decline).toHaveBeenCalledWith(OFFERED, "no_boat");
  });

  it("asks for the arrival estimate straight after accepting, and not before", () => {
    // Before accepting: nothing stands between the team and the case.
    draw();
    expect(card(OFFERED).querySelector("[data-eta-ask]")).toBeNull();
    document.body.innerHTML = "";

    const accepted = applyExample(
      EXAMPLE_AUTHORITY_BOARD,
      { action: "accept", sos: OFFERED },
      EXAMPLE_NOW,
    );
    const { taps } = draw(accepted);
    const mine = card(OFFERED);
    expect(mine.querySelectorAll("[data-eta]").length).toBe(5);
    fireEvent.click(mine.querySelector('[data-eta="to30"]')!);
    expect(taps.eta).toHaveBeenCalledWith(OFFERED, "to30");
  });

  it("a case another team holds can be seen but not taken", () => {
    draw();
    const theirs = card(THEIRS);
    expect(theirs.getAttribute("data-case-state")).toBe("held_by_other");
    expect(theirs.querySelector("[data-accept]")).toBeNull();
    expect(theirs.querySelector("[data-release]")).toBeNull();
  });

  it("a case the relay has passed, or run out on, can still be accepted", () => {
    draw();
    const unanswered = card(UNANSWERED);
    expect(unanswered.getAttribute("data-case-state")).toBe("unanswered");
    expect(unanswered.querySelector("[data-accept]")).not.toBeNull();
    expect(unanswered.textContent).toContain(th.authority.case.timedOut);
  });

  it("shows the suspected-spam flag and never hides the case", () => {
    draw();
    expect(document.body.textContent).toContain(th.authority.case.spamFlag);
  });

  it("warns that road directions do not know about the flood", () => {
    draw();
    const mine = card(MINE);
    expect(mine.querySelector("[data-navigate]")?.getAttribute("href")).toContain(
      "google.com/maps/dir",
    );
    expect(mine.textContent).toContain(th.authority.act.directionsWarning);
  });

  it("asks once to turn the alarm on, and says it only sounds with the page open", () => {
    const onArm = vi.fn();
    draw(EXAMPLE_AUTHORITY_BOARD, { onArm });
    const alarm = document.querySelector('[data-alarm="off"]')!;
    fireEvent.click(alarm.querySelector("button")!);
    expect(onArm).toHaveBeenCalled();
    expect(alarm.textContent).toContain(th.authority.alarm.openOnly);
  });

  it("the on-duty switch belongs to the team's own unit", () => {
    const { unit } = draw();
    fireEvent.click(document.querySelector("[data-duty]")!);
    expect(unit.duty).toHaveBeenCalledWith(EXAMPLE_AUTHORITY_BOARD.units[0]!.id, false);
  });

  it("uses no alert colour: only the SOS red carries a state", () => {
    draw();
    expect(document.body.innerHTML).not.toMatch(/bg-alert-(watch|warning|evacuate|normal)/);
  });
});

describe("who is coming, for the person who asked", () => {
  const team = (more: Partial<SosTeam> = {}): SosTeam => ({
    searching: false,
    exhausted: false,
    unitName: "ทีมกู้ภัยตัวอย่าง",
    orgName: "มูลนิธิตัวอย่าง",
    etaBand: "to30",
    etaGivenAt: "2026-11-20T09:10:00Z",
    acceptedAt: "2026-11-20T09:05:00Z",
    phoneAvailable: true,
    ...more,
  });
  const show = (t: SosTeam, phone: Parameters<typeof TeamStatus>[0]["phone"] = null) => {
    const onAskPhone = vi.fn();
    renderWithIntl(
      <TeamStatus
        team={t}
        createdAt="2026-11-20T09:00:00Z"
        now={EXAMPLE_NOW}
        phone={phone}
        asking={false}
        onAskPhone={onAskPhone}
      />,
    );
    return onAskPhone;
  };

  it("while nobody has accepted: says so, with the time waited and the hotlines, no promise", () => {
    show(team({ searching: true, unitName: null, orgName: null, etaBand: null }));
    const block = document.querySelector('[data-team="searching"]')!;
    expect(block.textContent).toContain(th.sos.team.searching);
    expect(block.textContent).toContain("30");
    expect(block.querySelector('a[href="tel:1784"]')).not.toBeNull();
    expect(block.querySelector('a[href="tel:1669"]')).not.toBeNull();
    expect(block.textContent).not.toContain(th.sos.team.accepted);
  });

  it("when the relay has run out it says the admins have it, and still no promise", () => {
    show(team({ searching: true, exhausted: true, unitName: null, etaBand: null }));
    expect(document.body.textContent).toContain(th.sos.team.exhausted);
    expect(document.body.textContent).toContain(th.sos.team.callNow);
  });

  it("names the team and gives the estimate as a range with the time it was given", () => {
    show(team());
    const block = document.querySelector('[data-team="accepted"]')!;
    expect(block.textContent).toContain("ทีมกู้ภัยตัวอย่าง");
    expect(block.textContent).toContain(th.sos.team.eta.to30);
    // Given at 16:10 Bangkok time: said as when the estimate was made, not as an arrival time.
    expect(block.textContent).toContain("16:10");
  });

  it("shows no number until the sender asks, then a call button", () => {
    const ask = show(team());
    expect(document.querySelector('[data-team] a[href^="tel:"]')).toBeNull();
    fireEvent.click(document.querySelector("[data-team-call]")!);
    expect(ask).toHaveBeenCalled();
    document.body.innerHTML = "";
    show(team(), { phone: "0898765432", isPoc: true, unitName: "ทีมกู้ภัยตัวอย่าง" });
    expect(document.querySelector('a[href="tel:0898765432"]')?.textContent).toContain(
      th.sos.team.phonePoc,
    );
  });

  it("chimes when a team accepts, resolves when it is over, and is quiet on opening", () => {
    const waiting = { status: "received" as const, hasTeam: false };
    expect(soundForChange(null, { status: "assigned", hasTeam: true })).toBeNull();
    expect(soundForChange(waiting, { status: "assigned", hasTeam: true })).toBe("accepted");
    expect(soundForChange(waiting, waiting)).toBeNull();
    expect(
      soundForChange({ status: "on_site", hasTeam: true }, { status: "rescued", hasTeam: false }),
    ).toBe("rescued");
    expect(soundForChange(waiting, { status: "safe_cancelled", hasTeam: false })).toBe("rescued");
    // A case closed as a nuisance send makes no sound of relief.
    expect(soundForChange(waiting, { status: "dismissed", hasTeam: false })).toBeNull();
  });
});

describe("the wording", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("exists in Thai, Malay and English, key for key", () => {
    for (const group of [(m: typeof th) => m.authority, (m: typeof th) => m.sos.team]) {
      const thai = keys(group(th)).sort();
      expect(keys(group(en as typeof th)).sort()).toEqual(thai);
      expect(keys(group(ms as typeof th)).sort()).toEqual(thai);
    }
  });

  it("never gives the arrival estimate as a clock time", () => {
    for (const m of [th, en, ms]) {
      for (const band of Object.values(m.sos.team.eta)) expect(band).not.toMatch(/\{time\}/);
    }
  });
});
