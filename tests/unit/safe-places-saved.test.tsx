import { describe, expect, it } from "vitest";
import { SafePlaces } from "@/components/places/SafePlaces";
import { EXAMPLE_PLACES } from "@/lib/dev-examples";
import { renderWithIntl } from "./render";

// 14 Oct 2026, 21:30 Bangkok.
const SAVED = Date.UTC(2026, 9, 14, 14, 30);

describe("safe places kept on the phone say how old they are (A9)", () => {
  it("a list that could not be refreshed says when it was saved", () => {
    const { container } = renderWithIntl(
      <SafePlaces places={EXAMPLE_PLACES} state="ok" fromPhone savedAt={SAVED} />,
    );
    const line = container.querySelector('[data-places-saved="time"]');
    expect(line?.textContent).toContain("บันทึกไว้ในโทรศัพท์");
    expect(line?.textContent).toContain("21:30");
  });

  it("a list kept before times were stored still says it is the phone's copy", () => {
    const { container } = renderWithIntl(
      <SafePlaces places={EXAMPLE_PLACES} state="ok" fromPhone savedAt={null} />,
      "en",
    );
    expect(container.querySelector('[data-places-saved="old"]')?.textContent).toContain(
      "saved on this phone",
    );
  });

  it("a list refreshed on this visit carries no such line", () => {
    const { container } = renderWithIntl(<SafePlaces places={EXAMPLE_PLACES} state="ok" />);
    expect(container.querySelector("[data-places-saved]")).toBeNull();
  });
});
