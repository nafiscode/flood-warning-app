import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopeWarning } from "@/components/admin/ScopeWarning";
import { renderWithIntl } from "./render";

/**
 * The question an admin is asked before a change that would cut a team off from a rescue it has
 * accepted (owner, 26 Nov 2026). The database holds the line; this is the page being polite about
 * it, so it must appear exactly when the change is one, and never otherwise.
 */
const CASES = [
  { tambon: "950101", name: "Bana", count: 2 },
  { tambon: "950201", name: "Kolok", count: 1 },
];
const TEXT = { body: "Open cases: {count}, in {places}.", confirm: "I understand" };

/** A stand-in for the edit form: what the area picker and the capability list render. */
function renderForm() {
  const view = renderWithIntl(
    <form>
      <input type="checkbox" name="capability" value="rescue" defaultChecked />
      <input type="checkbox" name="capability" value="planning" />
      <input type="checkbox" name="province" value="95" />
      <input type="checkbox" name="district" value="9501" />
      <input type="checkbox" name="tambon" value="950101" defaultChecked />
      <input type="checkbox" name="tambon" value="950102" />
      <input type="checkbox" name="tambon" value="950201" defaultChecked />
      <ScopeWarning openCases={CASES} text={TEXT} />
    </form>,
    "en",
  );
  const box = (name: string, value: string) =>
    view.container.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!;
  const toggle = (name: string, value: string) => fireEvent.click(box(name, value));
  const warning = () => view.container.querySelector("[role=alert]");
  const confirm = () => view.container.querySelector('input[name="confirmOpen"]');
  return { view, toggle, warning, confirm };
}

describe("the open-case warning on the team editor", () => {
  it("stays quiet while nothing that matters has changed", () => {
    const { warning, confirm, view } = renderForm();
    expect(warning()).toBeNull();
    expect(confirm()).toBeNull();
    expect(
      view.container.querySelector("[data-scope-warning]")!.getAttribute("data-scope-warning"),
    ).toBe("off");
  });

  it("names the cases and asks for a tick when a tambon with an accepted case is unticked", () => {
    const { toggle, warning, confirm } = renderForm();
    toggle("tambon", "950101");
    expect(warning()!.textContent).toContain("Open cases: 2, in Bana.");
    const tick = confirm() as HTMLInputElement;
    expect(tick.required).toBe(true);
    expect(tick.value).toBe("yes");
    // Putting it back removes the question, and the box with it, so nothing stale is submitted.
    toggle("tambon", "950101");
    expect(warning()).toBeNull();
    expect(confirm()).toBeNull();
  });

  it("adds the cases together when two tambons go", () => {
    const { toggle, warning } = renderForm();
    toggle("tambon", "950101");
    toggle("tambon", "950201");
    expect(warning()!.textContent).toContain("Open cases: 3, in Bana, Kolok.");
  });

  it("counts a tambon as kept when its district or province is ticked instead", () => {
    const { toggle, warning } = renderForm();
    toggle("tambon", "950101");
    expect(warning()).not.toBeNull();
    toggle("district", "9501");
    expect(warning()).toBeNull();
    toggle("tambon", "950201");
    expect(warning()!.textContent).toContain("Kolok");
    toggle("province", "95");
    expect(warning()).toBeNull();
  });

  it("asks when the unit would be left with planning and dam work only, whatever the area", () => {
    const { toggle, warning } = renderForm();
    toggle("capability", "planning");
    expect(warning()).toBeNull();
    toggle("capability", "rescue");
    expect(warning()!.textContent).toContain("Open cases: 3, in Bana, Kolok.");
  });

  it("is never shown for a team with no open case", () => {
    const view = renderWithIntl(
      <form>
        <input type="checkbox" name="tambon" value="950101" defaultChecked />
        <ScopeWarning openCases={[]} text={TEXT} />
      </form>,
      "en",
    );
    fireEvent.click(view.container.querySelector('input[name="tambon"]')!);
    expect(view.container.querySelector("[role=alert]")).toBeNull();
  });
});
