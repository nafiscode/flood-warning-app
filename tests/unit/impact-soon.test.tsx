import { describe, expect, it } from "vitest";
import { ImpactSoon } from "@/components/impact/ImpactSoon";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The public impact page before there is anything real to report. The rule it holds: not one
 * figure from the invented season can reach a visitor, and nothing on it reads as "all clear".
 */
describe("the public impact page with no figures", () => {
  it("shows the promise and the honesty rules, and no dashboard", () => {
    const { container } = renderWithIntl(<ImpactSoon />);
    expect(container.querySelector("[data-impact-soon]")).not.toBeNull();
    expect(container.querySelector("[data-impact-panel]")).toBeNull();
    expect(container.textContent).toContain(th.impactPublic.status.title);
    expect(container.textContent).toContain(th.impactPublic.rules.one);
    expect(container.querySelectorAll("section")).toHaveLength(5);
  });

  it("carries no invented number or the example banner", () => {
    const { container } = renderWithIntl(<ImpactSoon />, "en");
    const text = container.textContent ?? "";
    expect(text).not.toContain(en.impact.example.title);
    // The only digits are the four hotlines in the help block.
    expect(text.match(/\d+/g)).toEqual(["1784", "1669", "191", "199"]);
  });

  it("points a visitor in trouble to SOS and the hotlines", () => {
    const { container } = renderWithIntl(<ImpactSoon />);
    expect(container.querySelector('a[href="/sos"]')).not.toBeNull();
    for (const number of ["1784", "1669", "191", "199"]) {
      expect(container.textContent).toContain(number);
    }
  });

  it("is written in all three languages, and says an empty page is not an all-clear", () => {
    for (const messages of [th, en, ms]) {
      expect(messages.impactPublic.status.body.length).toBeGreaterThan(40);
    }
    expect(en.impactPublic.status.body).toContain("does not mean nobody needed help");
  });
});
