import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HatYaiCameras } from "@/components/cctv/HatYaiCameras";
import { HATYAI_CAMS, HATYAI_SOURCE_URL } from "@/lib/hatyai-cams";
import { renderWithIntl } from "./render";

/*
 * The window shows a third party's live frames inside Jaga. These tests pin the safe parts: it opens
 * over the app and closes again; every frame is loaded straight from the agency over https (Jaga
 * hosts nothing); and the source link hands a government/community site no referrer or opener.
 */
describe("the Hat Yai cameras window", () => {
  it("opens over the app and shows every camera's live frame from the agency", () => {
    const { container } = renderWithIntl(<HatYaiCameras />, "en");
    expect(container.querySelector("[data-hatyai-cams-window]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hat Yai flood cameras" }));

    const dialog = screen.getByRole("dialog");
    const frames = dialog.querySelectorAll("[data-cam-frame]");
    expect(frames.length).toBe(HATYAI_CAMS.length);
    frames.forEach((img) => {
      const src = img.getAttribute("src") ?? "";
      expect(src.startsWith("https://hatyaicityclimate.org/floodphoto/last/")).toBe(true);
      // A refresh cache-buster, so a frozen cache can never masquerade as a live frame.
      expect(src).toContain("?t=");
      expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    });
  });

  it("links out to the source with no referrer or opener handed over", () => {
    renderWithIntl(<HatYaiCameras />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Hat Yai flood cameras" }));
    const source = document
      .querySelector("[data-hatyai-cams-source]") as HTMLAnchorElement | null;
    expect(source).not.toBeNull();
    expect(source!.getAttribute("href")).toBe(HATYAI_SOURCE_URL);
    expect(source!.getAttribute("target")).toBe("_blank");
    expect(source!.getAttribute("rel")).toContain("noopener");
  });

  it("closes on Escape", () => {
    renderWithIntl(<HatYaiCameras />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Hat Yai flood cameras" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
