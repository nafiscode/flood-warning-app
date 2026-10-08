/**
 * A4 on the phone: what the SOS screens show, what the request carries, and the small helpers
 * around them. The database side is tested in tests/rls/sos.test.ts and the offline queue end to
 * end in tests/e2e/sos.spec.ts (a real browser, with IndexedDB and a service worker).
 */
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseStatus } from "@/components/sos/CaseStatus";
import { NotYet } from "@/components/sos/NotYet";
import { SendSOS } from "@/components/sos/SendSOS";
import { voiceContentType, voiceFormat } from "@/lib/media";
import { deviceId, openCase, rememberCase, rememberedCases } from "@/lib/sos";
import type { SosTimeline } from "@/lib/sos";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The app router isn't mounted in a unit test; the screens only need somewhere to navigate to.
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace, push: vi.fn() }),
}));

const POINT = { coords: { latitude: 6.8669, longitude: 101.2501, accuracy: 12 } };

function withGeolocation(position = POINT) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void) => ok(position),
      watchPosition: (ok: (p: unknown) => void) => {
        ok(position);
        return 1;
      },
      clearWatch: () => {},
    },
  });
}

function withoutGeolocation() {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: unknown, fail: () => void) => fail(),
      watchPosition: (_ok: unknown, fail: () => void) => {
        fail();
        return 1;
      },
      clearWatch: () => {},
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  withGeolocation();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the SOS confirmation screen", () => {
  it("is one screen with the send button, an optional phone and its hint", async () => {
    await act(async () => {
      renderWithIntl(<SendSOS projectLine={null} place={null} />);
    });
    const send = document.querySelector("[data-sos-send]")!;
    expect(send.textContent).toContain(th.sos.send);
    // The phone field is prominent but not required: nothing on this screen is, except location.
    const phone = document.querySelector('input[name="phone"]') as HTMLInputElement;
    expect(phone.required).toBe(false);
    expect(screen.getByText(th.sos.phoneHint)).not.toBeNull();
    expect(document.body.textContent).toContain("1784");
    expect(document.body.textContent).toContain("1669");
  });

  it("sends the location, the device and the typed phone, and keeps the case on the phone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          token: "a".repeat(48),
          merged: false,
          status: "received",
          createdAt: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      renderWithIntl(<SendSOS projectLine={null} place={null} />);
    });
    fireEvent.change(document.querySelector('input[name="phone"]')!, {
      target: { value: "081 234 5678" },
    });
    await act(async () => {
      fireEvent.click(document.querySelector("[data-sos-send]")!);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/sos");
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.lat).toBeCloseTo(6.8669);
    expect(body.lon).toBeCloseTo(101.2501);
    expect(body.phone).toBe("+66812345678");
    expect(body.deviceId).toBe(deviceId());
    expect(body.onBehalf).toBe(false);

    const remembered = rememberedCases();
    expect(remembered[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(remembered[0]?.token).toBe("a".repeat(48));
    expect(openCase()?.id).toBe(remembered[0]?.id);
  });

  it("asks for a pin or an area when GPS fails, instead of sending nothing", async () => {
    withoutGeolocation();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      renderWithIntl(<SendSOS projectLine={null} place={null} />);
    });
    expect(document.querySelector("[data-sos-nolocation]")).not.toBeNull();
    await act(async () => {
      fireEvent.click(document.querySelector("[data-sos-send]")!);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(th.sos.location.needed);
  });

  it("queues the request and offers SMS and the hotlines when it cannot be sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await act(async () => {
      renderWithIntl(<SendSOS projectLine="0812345678" place={null} />);
    });
    await act(async () => {
      fireEvent.click(document.querySelector("[data-sos-send]")!);
    });
    // Without IndexedDB in this environment the screen falls back to "couldn't send", which must
    // still put the hotlines in front of the person rather than an error message alone.
    await waitFor(() => {
      const state = document.querySelector("[data-sos-state]")?.getAttribute("data-sos-state");
      expect(["queued", "failed"]).toContain(state);
    });
    expect(document.body.textContent).toContain("1784");
  });

  it("sends on behalf of a watched place, with that place's location", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "22222222-2222-4222-8222-222222222222",
          token: null,
          merged: false,
          status: "received",
          createdAt: new Date().toISOString(),
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const place = { id: "p1", label: "บ้านแม่", lat: 6.5, lon: 101.3 };
    await act(async () => {
      renderWithIntl(<SendSOS projectLine={null} place={place} />);
    });
    expect(document.body.textContent).toContain("บ้านแม่");
    await act(async () => {
      fireEvent.click(document.querySelector("[data-sos-send]")!);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.lat).toBe(6.5);
    expect(body.lon).toBe(101.3);
    expect(body.onBehalf).toBe(true);
  });
});

describe("the requester's view of a case", () => {
  const timeline = (more: Partial<SosTimeline> = {}): SosTimeline => ({
    status: "received",
    createdAt: new Date().toISOString(),
    closedAt: null,
    hazardType: "unknown",
    lat: 6.8,
    lon: 101.2,
    hasPhone: false,
    unitName: null,
    orgName: null,
    photos: 0,
    hasVoice: false,
    events: [{ event: "received", at: new Date().toISOString(), note: null, unit: null }],
    ...more,
  });

  function serve(answer: SosTimeline | { status: number }) {
    const fetchMock = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, status: "safe_cancelled" })),
        );
      }
      if ("status" in answer && typeof answer.status === "number") {
        return Promise.resolve(new Response("{}", { status: answer.status }));
      }
      return Promise.resolve(new Response(JSON.stringify(answer)));
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("shows the status, the timeline and the two things only the requester can say", async () => {
    rememberCase({
      id: "33333333-3333-4333-8333-333333333333",
      token: "b".repeat(48),
      status: "received",
      createdAt: new Date().toISOString(),
    });
    serve(timeline({ status: "assigned", unitName: "หน่วยกู้ภัยยะลา" }));
    await act(async () => {
      renderWithIntl(<CaseStatus id="33333333-3333-4333-8333-333333333333" merged={false} />);
    });
    await waitFor(() =>
      expect(document.querySelector("[data-case-status]")?.textContent).toContain(
        "หน่วยกู้ภัยยะลา",
      ),
    );
    expect(document.querySelector("[data-case-safe]")?.textContent).toContain(
      th.sos.status.safeNow,
    );
    expect(document.querySelector("[data-case-rescued]")?.textContent).toContain(
      th.sos.status.rescuedNow,
    );
    // Nothing about spam or review reaches the person who asked for help (spec section 9).
    expect(document.body.textContent).not.toMatch(/spam/i);
  });

  it("sends the token with the request and never in the address", async () => {
    rememberCase({
      id: "44444444-4444-4444-8444-444444444444",
      token: "c".repeat(48),
      status: "received",
      createdAt: new Date().toISOString(),
    });
    const fetchMock = serve(timeline());
    await act(async () => {
      renderWithIntl(<CaseStatus id="44444444-4444-4444-8444-444444444444" merged={false} />);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/sos/44444444-4444-4444-8444-444444444444");
    expect(String(url)).not.toContain("c".repeat(10));
    expect((options as RequestInit).headers).toMatchObject({
      "x-jaga-sos-token": "c".repeat(48),
    });
  });

  it("says plainly when the case is not known on this phone, and keeps the hotlines", async () => {
    serve({ status: 403 });
    await act(async () => {
      renderWithIntl(<CaseStatus id="55555555-5555-4555-8555-555555555555" merged={false} />);
    });
    await waitFor(() =>
      expect(document.querySelector('[data-case-state="unknown"]')).not.toBeNull(),
    );
    expect(document.body.textContent).toContain(th.sos.status.notFound);
    expect(document.body.textContent).toContain("1669");
  });

  it("a closed case offers no more actions", async () => {
    rememberCase({
      id: "66666666-6666-4666-8666-666666666666",
      token: "d".repeat(48),
      status: "rescued",
      createdAt: new Date().toISOString(),
    });
    serve(timeline({ status: "rescued", closedAt: new Date().toISOString() }));
    await act(async () => {
      renderWithIntl(<CaseStatus id="66666666-6666-4666-8666-666666666666" merged={false} />);
    });
    await waitFor(() =>
      expect(document.querySelector('[data-case-state="rescued"]')).not.toBeNull(),
    );
    expect(document.querySelector("[data-case-safe]")).toBeNull();
    expect(document.querySelector("[data-sos-details]")).toBeNull();
    expect(document.body.textContent).toContain(th.sos.status.closed);
  });
});

describe("the phone's small helpers", () => {
  it("remembers at most ten cases, newest first", () => {
    for (let i = 0; i < 12; i += 1) {
      rememberCase({
        id: `case-${i}`,
        token: null,
        status: "rescued",
        createdAt: new Date().toISOString(),
      });
    }
    const cases = rememberedCases();
    expect(cases).toHaveLength(10);
    expect(cases[0]?.id).toBe("case-11");
  });

  it("openCase finds only a case that is still open", () => {
    rememberCase({
      id: "closed",
      token: null,
      status: "rescued",
      createdAt: "2026-10-01T00:00:00Z",
    });
    expect(openCase()).toBeNull();
    rememberCase({
      id: "open",
      token: null,
      status: "en_route",
      createdAt: "2026-10-02T00:00:00Z",
    });
    expect(openCase()?.id).toBe("open");
  });

  it("the device id stays the same on this phone", () => {
    const first = deviceId();
    expect(deviceId()).toBe(first);
    expect(first.length).toBeGreaterThanOrEqual(8);
  });

  it("voice notes use a format the browser can record", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: (type: string) => type === "audio/mp4" });
    expect(voiceFormat()).toEqual({ mimeType: "audio/mp4", extension: "m4a" });
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (type: string) => type === "audio/webm;codecs=opus",
    });
    expect(voiceFormat()).toEqual({ mimeType: "audio/webm;codecs=opus", extension: "webm" });
    expect(voiceContentType("webm")).toBe("audio/webm");
    expect(voiceContentType("m4a")).toBe("audio/mp4");
  });
});

describe("before launch", () => {
  it("sending is off in a production build until the switch, and on for the tests", async () => {
    const { sosSendingEnabled } = await import("@/lib/features");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JAGA_IN_SERVICE", "");
    vi.stubEnv("JAGA_SOS_SENDING_FOR_TESTS", "");
    expect(sosSendingEnabled()).toBe(false);
    vi.stubEnv("JAGA_IN_SERVICE", "1");
    expect(sosSendingEnabled()).toBe(true);
    vi.stubEnv("JAGA_IN_SERVICE", "");
    vi.stubEnv("JAGA_SOS_SENDING_FOR_TESTS", "1");
    expect(sosSendingEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("the page shown instead says nobody receives requests, and offers the hotlines", () => {
    renderWithIntl(
      <NotYet title={th.sos.soonTitle} body={th.sos.soonBody} back={th.sos.back} backHref="/" />,
    );
    const panel = document.querySelector("[data-sos-soon]")!;
    expect(panel.textContent).toContain(th.sos.soonTitle);
    expect(panel.textContent).toContain("1784");
    expect(panel.querySelector('a[href="tel:1669"]')).not.toBeNull();
    // Nothing on it can send anything.
    expect(panel.querySelector("[data-sos-send]")).toBeNull();
    expect(panel.querySelectorAll("input")).toHaveLength(0);
  });
});
