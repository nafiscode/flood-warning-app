/**
 * The war room's reservoir rows after the reservoirs got their own panel (the owner, 27 Oct 2026:
 * "maybe we can remove dam section in the Admin/war room, since it has its own place").
 *
 * It was not removed: the row that marks a confirmed release reviewed is the admin's decision and
 * belongs on the screen they keep open in an event. What it stops doing is listing every quiet
 * reservoir in full while somebody is waiting for a boat.
 */
import { describe, expect, it } from "vitest";
import { DamBoard } from "@/components/admin/DamBoard";
import { exampleDamSignal } from "@/lib/dev-examples";
import { EXAMPLE_DAMS } from "@/lib/war-room-examples";
import type { DamBoardRow } from "@/lib/war-room";
import { renderWithIntl } from "./render";

const NOW = Date.parse("2026-11-20T09:30:00Z");
const releasing = EXAMPLE_DAMS[0]!;

const quiet = (code: string): DamBoardRow => ({
  ...releasing,
  code,
  name: { th: "อ่างเก็บน้ำ" + code, en: code },
  signal: exampleDamSignal("quiet"),
  notice: null,
});

describe("the war room's reservoirs", () => {
  it("keeps a reservoir that is doing something, with its review row", () => {
    const { container } = renderWithIntl(<DamBoard dams={[releasing]} now={NOW} review={null} />);
    expect(container.querySelector('[data-dam-board="bang_lang"]')).not.toBeNull();
    expect(container.querySelector('[data-dam-notice="open"]')).not.toBeNull();
    // Nothing is said about quiet ones when there are none.
    expect(container.querySelector("[data-dam-quiet]")).toBeNull();
  });

  it("puts the quiet ones in one line, pointing at the panel that holds them", () => {
    const { container } = renderWithIntl(
      <DamBoard dams={[releasing, quiet("khlong_la"), quiet("ban_baik")]} now={NOW} review={null} />,
    );
    expect(container.querySelector('[data-dam-board="bang_lang"]')).not.toBeNull();
    expect(container.querySelector('[data-dam-board="khlong_la"]')).toBeNull();
    expect(container.querySelector('[data-dam-board="ban_baik"]')).toBeNull();
    expect(container.querySelector("[data-dam-quiet]")!.getAttribute("data-dam-quiet")).toBe("2");
    expect(container.querySelector('a[href*="/admin/signals"]')).not.toBeNull();
  });

  it("keeps a watchful reservoir even with no notice: it is the state that rings the phones", () => {
    const watchful: DamBoardRow = { ...quiet("khlong_chamrai"), signal: exampleDamSignal("watch") };
    const { container } = renderWithIntl(<DamBoard dams={[watchful]} now={NOW} review={null} />);
    expect(container.querySelector('[data-dam-board="khlong_chamrai"]')).not.toBeNull();
    expect(container.querySelector("[data-dam-quiet]")).toBeNull();
  });

  it("with every reservoir quiet it is one line, not six cards", () => {
    const { container } = renderWithIntl(
      <DamBoard dams={[quiet("a"), quiet("b"), quiet("c")]} now={NOW} review={null} />,
    );
    expect(container.querySelectorAll("[data-dam-board]")).toHaveLength(0);
    expect(container.querySelector("[data-dam-quiet]")!.getAttribute("data-dam-quiet")).toBe("3");
  });

  it("draws nothing at all when there are no reservoirs", () => {
    const { container } = renderWithIntl(<DamBoard dams={[]} now={NOW} review={null} />);
    expect(container.querySelector("[data-dam-quiet]")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
