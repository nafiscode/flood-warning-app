import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeView } from "@/components/home/HomeView";
import { InstallCardView, type InstallCardViewProps } from "@/components/InstallCard";
import { EXAMPLE_NOW, EXAMPLE_PLACES, homeExample, type HomeScenario } from "@/lib/dev-examples";
import {
  INSTALL_LATER_MS,
  installDevice,
  installGuide,
  installSnoozed,
  type InstallGuide,
} from "@/lib/install";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  iphoneMessenger:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/465.0.0;FBBV/1]",
  androidLine:
    "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.9.0/IAB",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  windowsFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("which steps a browser is shown", () => {
  it("names the right guide for each browser", () => {
    expect(installGuide(UA.iphoneSafari, 5)).toBe("iosSafari");
    expect(installGuide(UA.iphoneChrome, 5)).toBe("iosOther");
    expect(installGuide(UA.androidChrome, 5)).toBe("android");
    expect(installGuide(UA.macSafari)).toBe("macSafari");
    expect(installGuide(UA.macChrome)).toBe("desktop");
    expect(installGuide(UA.windowsEdge)).toBe("desktop");
    expect(installGuide(UA.windowsFirefox)).toBe("desktop");
  });

  it("an in-app browser is told to leave it first, whatever the phone", () => {
    expect(installGuide(UA.iphoneMessenger, 5)).toBe("inApp");
    expect(installGuide(UA.androidLine, 5)).toBe("inApp");
  });

  it("an iPad that calls itself a Mac is still an iPad", () => {
    expect(installGuide(UA.macSafari, 5)).toBe("iosSafari");
    expect(installDevice(UA.macSafari, 5)).toBe("phone");
    expect(installDevice(UA.macSafari, 0)).toBe("computer");
  });

  it("says home screen on a phone and computer on a laptop", () => {
    expect(installDevice(UA.androidChrome, 5)).toBe("phone");
    expect(installDevice(UA.iphoneSafari, 5)).toBe("phone");
    expect(installDevice(UA.windowsEdge)).toBe("computer");
  });

  it("'Not now' is honoured for three weeks and then forgotten", () => {
    const now = 1_800_000_000_000;
    expect(installSnoozed(null, now)).toBe(false);
    expect(installSnoozed(now - 1000, now)).toBe(true);
    expect(installSnoozed(now - INSTALL_LATER_MS - 1, now)).toBe(false);
  });
});

function view(more: Partial<InstallCardViewProps> = {}) {
  const props: InstallCardViewProps = {
    device: "phone",
    guide: "iosSafari",
    canAsk: false,
    onInstall: vi.fn(async () => "accepted" as const),
    ...more,
  };
  return { props, c: renderWithIntl(<InstallCardView {...props} />).container };
}

describe("the install card", () => {
  it("opens the browser's own dialog where there is one, and shows no steps", async () => {
    const { props, c } = view({ canAsk: true, guide: "android" });
    fireEvent.click(c.querySelector("[data-install-button]")!);
    await waitFor(() => expect(props.onInstall).toHaveBeenCalledTimes(1));
    expect(c.querySelector("[data-install-guide]")).toBeNull();
  });

  it("on an iPhone the button shows the three steps instead", () => {
    const { props, c } = view();
    fireEvent.click(c.querySelector("[data-install-button]")!);
    const steps = c.querySelectorAll('[data-install-guide="iosSafari"] li');
    expect(steps).toHaveLength(3);
    expect(steps[1]!.textContent).toContain(th.install.guide.iosSafari.s2);
    expect(steps[1]!.querySelector("svg")).not.toBeNull();
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("falls back to the steps when the dialog could not be opened", async () => {
    const { c } = view({
      canAsk: true,
      guide: "android",
      onInstall: async () => "unavailable",
    });
    fireEvent.click(c.querySelector("[data-install-button]")!);
    await waitFor(() => expect(c.querySelector('[data-install-guide="android"]')).not.toBeNull());
  });

  it("'Not now' is offered only where it is given", () => {
    expect(view().c.querySelector("[data-install-later]")).toBeNull();
    const onLater = vi.fn();
    const { c } = view({ onLater });
    fireEvent.click(c.querySelector("[data-install-later]")!);
    expect(onLater).toHaveBeenCalled();
  });

  it("every guide has a text for each of its pictures, in all three languages", () => {
    const guides: InstallGuide[] = [
      "inApp",
      "iosSafari",
      "iosOther",
      "android",
      "macSafari",
      "desktop",
    ];
    for (const guide of guides) {
      const { c } = view({ guide });
      fireEvent.click(c.querySelector("[data-install-button]")!);
      const count = c.querySelectorAll("[data-install-guide] li").length;
      for (const messages of [th, ms, en]) {
        expect(Object.keys(messages.install.guide[guide])).toHaveLength(count);
      }
    }
  });
});

describe("the install card on the home screen", () => {
  function home(scenario: HomeScenario) {
    const example = homeExample(scenario);
    return renderWithIntl(
      <HomeView
        ready
        status={example.status}
        checkedAt={example.status ? EXAMPLE_NOW - 60_000 : null}
        failed={example.failed}
        area={example.area}
        me={example.me}
        places={EXAMPLE_PLACES}
        placesState="ok"
        now={EXAMPLE_NOW}
        onChooseArea={() => {}}
        onRetry={() => {}}
        projectLine={null}
        install={<div data-install-slot="true" />}
      />,
    ).container;
  }

  it("is the last thing on the screen, after SOS and everything else", () => {
    const c = home("normal");
    const slot = c.querySelector("[data-install-slot]")!;
    expect(slot).not.toBeNull();
    const all = [...c.querySelectorAll("a, button, section")];
    expect(
      all.every((el) => el.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("is not shown while the tambon is at Warning or Evacuate", () => {
    expect(home("warning").querySelector("[data-install-slot]")).toBeNull();
    expect(home("evacuate").querySelector("[data-install-slot]")).toBeNull();
  });
});
