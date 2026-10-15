import { describe, expect, it, vi } from "vitest";
import { BoardView } from "@/components/authority/BoardView";
import { EXAMPLE_AUTHORITY_BOARD, EXAMPLE_NOW } from "@/lib/authority-examples";
import { villageDistance, type AuthorityBoard } from "@/lib/dispatch";
import { renderWithIntl } from "./render";

function draw(board: AuthorityBoard, locale: "th" | "en") {
  const fn = vi.fn();
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
      actions={{
        accept: fn,
        decline: fn,
        eta: fn,
        advance: fn,
        release: fn,
        phone: fn,
        complete: fn,
        confirm: fn,
        media: fn,
      }}
      unitActions={{ duty: fn, sharing: fn }}
    />,
    locale,
  );
}

const withVillage = (): AuthorityBoard => {
  const [first, ...rest] = EXAMPLE_AUTHORITY_BOARD.cases;
  return {
    ...EXAMPLE_AUTHORITY_BOARD,
    cases: [
      { ...first!, village: { nameTh: "บ้านยูโย", nameEn: "Ban Yuyo", distanceM: 412 } },
      ...rest.map((c) => ({ ...c, village: null })),
    ],
  };
};

describe("the village on a team's board (S3 villages, 16 Oct)", () => {
  it("says the distance to 50 m under a kilometre, and in tenths of a km beyond", () => {
    expect(villageDistance(0)).toEqual({ unit: "m", value: 50 });
    expect(villageDistance(412)).toEqual({ unit: "m", value: 400 });
    expect(villageDistance(990)).toEqual({ unit: "m", value: 1000 });
    expect(villageDistance(1000)).toEqual({ unit: "km", value: 1 });
    expect(villageDistance(3460)).toEqual({ unit: "km", value: 3.5 });
  });

  it("a case near a village names it; a case with none says nothing", () => {
    draw(withVillage(), "th");
    const lines = [...document.querySelectorAll("[data-case-village]")];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe("ใกล้บ้านยูโย ประมาณ 400 ม.");
  });

  it("in English it adds the English name when there is one", () => {
    draw(withVillage(), "en");
    expect(document.querySelector("[data-case-village]")!.textContent).toBe(
      "Near บ้านยูโย (Ban Yuyo), about 400 m",
    );
  });
});
