import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { ALERT_LEVELS } from "@/lib/brand/tokens";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const nextUpdateAt = new Date("2026-11-20T07:00:00Z"); // 14:00 Bangkok

describe("AlertBadge: never color alone", () => {
  it.each(ALERT_LEVELS)("%s shows an icon and its Thai label", (level) => {
    const { container } = renderWithIntl(<AlertBadge level={level} />);
    const badge = container.querySelector(`[data-level="${level}"]`);
    expect(badge).not.toBeNull();
    expect(badge?.querySelector("svg")).not.toBeNull();
    expect(badge?.textContent).toBe(th.alert.level[level]);
  });
});

describe("AlertStatus: stale is a marker, never a level (safety rule 3)", () => {
  it("shows only the badge before the next-update time", () => {
    const { container } = renderWithIntl(
      <AlertStatus
        level="warning"
        nextUpdateAt={nextUpdateAt}
        now={new Date("2026-11-20T06:59:00Z")}
      />,
    );
    expect(container.querySelector('[data-level="warning"]')).not.toBeNull();
    expect(container.querySelector("[data-stale]")).toBeNull();
  });

  it.each(ALERT_LEVELS)(
    "a stale %s alert keeps its level badge and adds the grey marker",
    (level) => {
      const { container } = renderWithIntl(
        <AlertStatus
          level={level}
          nextUpdateAt={nextUpdateAt}
          now={new Date("2026-11-20T09:30:00Z")}
        />,
      );
      const badge = container.querySelector(`[data-level="${level}"]`);
      expect(badge?.textContent).toBe(th.alert.level[level]);
      const marker = container.querySelector("[data-stale]");
      expect(marker).not.toBeNull();
      // The marker comes after the badge, never before or instead of it.
      expect(
        badge!.compareDocumentPosition(marker!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it("shows the stale time in Bangkok time", () => {
    renderWithIntl(
      <AlertStatus
        level="evacuate"
        nextUpdateAt={nextUpdateAt}
        now={new Date("2026-11-20T09:30:00Z")}
      />,
      "en",
    );
    expect(screen.getByText(/Not updated since .*14:00/)).toBeTruthy();
  });
});
