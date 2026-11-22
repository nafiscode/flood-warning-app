import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CameraWindow } from "@/components/cctv/CameraWindow";
import { CCTV_SOURCES } from "@/lib/cctv";
import { renderWithIntl } from "./render";

/*
 * The camera window links out to an agency's own live cameras; it never hosts or embeds a page that
 * forbids being framed. These tests pin the two things that keep it safe: it does not embed such a
 * page (safety rule 6's spirit - we show only what the source lets us), and no source is marked
 * embeddable until a page is proven framable AND timestamped, so a frozen camera can never read as
 * live (safety rules 8 and 10).
 */

describe("the camera window", () => {
  it("opens over the app and launches the agency's own site, embedding nothing", () => {
    const { container } = renderWithIntl(<CameraWindow source="riverGauge" />, "en");

    // Closed to begin with: only the trigger is on the page.
    expect(container.querySelector("[data-cctv-window]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Official live cameras" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // DDPM forbids framing, so the window must link out, not embed.
    expect(dialog.querySelector("iframe")).toBeNull();

    const launch = dialog.querySelector("[data-cctv-launch]") as HTMLAnchorElement | null;
    expect(launch).not.toBeNull();
    expect(launch!.getAttribute("href")).toBe(CCTV_SOURCES.riverGauge.url);
    // A new window, with no referrer or opener handed to a government site.
    expect(launch!.getAttribute("target")).toBe("_blank");
    expect(launch!.getAttribute("rel")).toContain("noopener");
  });

  it("closes on Escape", () => {
    renderWithIntl(<CameraWindow source="dam" />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Official live cameras" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps every source non-embeddable until its page is proven framable and timestamped", () => {
    for (const source of Object.values(CCTV_SOURCES)) {
      expect(source.embeddable).toBe(false);
      expect(source.url.startsWith("https://")).toBe(true);
    }
  });
});
