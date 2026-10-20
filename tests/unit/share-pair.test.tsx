import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SharePair } from "@/components/SharePair";

const PAGE = { path: "/about", title: "Who built Jaga", text: "about", button: "Share this page" };
const APP = { path: "/", title: "Jaga", text: "the app", button: "Share Jaga" };

function draw() {
  return render(
    <SharePair
      heading="Pass it on"
      body="body"
      page={PAGE}
      app={APP}
      copied="Copied"
      manual="Copy"
    />,
  );
}

/**
 * The whole reason this exists beside `ShareApp`: that one always sends the home page, because it
 * sits on screens where the current address could be somebody's own SOS case. Here the current
 * page *is* the thing worth sending, and sending the home page instead would quietly lose what
 * the reader meant to show.
 */
describe("the share pair at the foot of a page somebody reads", () => {
  it("sends this page from one button and Jaga from the other", async () => {
    const shared: { title: string; url: string }[] = [];
    vi.stubGlobal("navigator", {
      share: async (d: { title: string; url: string }) => void shared.push(d),
    });
    draw();
    fireEvent.click(screen.getByText("Share this page"));
    fireEvent.click(screen.getByText("Share Jaga"));
    await vi.waitFor(() => expect(shared).toHaveLength(2));
    expect(new URL(shared[0]!.url).pathname).toBe("/about");
    expect(shared[0]!.title).toBe("Who built Jaga");
    expect(new URL(shared[1]!.url).pathname).toBe("/");
    expect(shared[1]!.title).toBe("Jaga");
    vi.unstubAllGlobals();
  });

  it("falls back to copying, and then to showing the link", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: { writeText: async (t: string) => void written.push(t) },
    });
    const copied = draw();
    fireEvent.click(screen.getByText("Share this page"));
    // Wait on the render, not on the clipboard: the copy resolves inside the handler, before
    // the state it sets has been painted.
    await vi.waitFor(() =>
      expect(
        copied.container.querySelector("[data-share-pair]")?.getAttribute("data-share-pair"),
      ).toBe("copied"),
    );
    expect(written).toHaveLength(1);
    expect(new URL(written[0]!).pathname).toBe("/about");
    copied.unmount();

    vi.stubGlobal("navigator", {});
    const manual = draw();
    fireEvent.click(screen.getByText("Share Jaga"));
    await vi.waitFor(() =>
      expect(
        manual.container.querySelector("[data-share-pair]")?.getAttribute("data-share-pair"),
      ).toBe("manual"),
    );
    expect(manual.container.querySelector("input")?.value).toBe("http://localhost:3000/");
    vi.unstubAllGlobals();
  });
});
