import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AreaChooser } from "@/components/home/AreaChooser";
import { LocationFinder } from "@/components/home/LocationFinder";
import { PinOnMap } from "@/components/sos/PinOnMap";
import type { Area, AreaDirectory, Located } from "@/lib/area";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The box for people who have not signed in (the owner, 23 Oct 2026): exact coordinates and tambon
 * names on the home screen's area chooser, and over the SOS pin map. What matters here: a pasted
 * position stays exact, a tambon picked by name is the area itself, and with the list unavailable
 * the box still takes coordinates.
 */
const BANA: Area = {
  code: "940104",
  nameTh: "บานา",
  nameEn: "Bana",
  districtTh: "เมืองปัตตานี",
  districtEn: "Mueang Pattani",
  provinceTh: "ปัตตานี",
  provinceEn: "Pattani",
  lat: 6.878,
  lon: 101.272,
  from: "gps",
};

const DIRECTORY: AreaDirectory = {
  provinces: [{ code: "94", nameTh: "ปัตตานี", nameEn: "Pattani", status: "active" }],
  tambons: [
    {
      code: "940104",
      nameTh: "บานา",
      nameEn: "Bana",
      districtCode: "9401",
      districtTh: "เมืองปัตตานี",
      districtEn: "Mueang Pattani",
      provinceCode: "94",
      lat: 6.878,
      lon: 101.272,
    },
  ],
};

const calls: string[] = [];
let areasOk = true;
let located: Located = { kind: "tambon", area: BANA };

beforeEach(() => {
  calls.length = 0;
  areasOk = true;
  located = { kind: "tambon", area: BANA };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url).startsWith("/api/geo/areas")) {
        if (!areasOk) throw new Error("offline");
        return new Response(JSON.stringify(DIRECTORY), { status: 200 });
      }
      if (String(url).startsWith("/api/geo/locate")) {
        return new Response(JSON.stringify(located), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const box = () => screen.getByPlaceholderText(th.locationFinder.placeholder);
const search = () => screen.getByRole("button", { name: th.locationFinder.search });
function type(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(search());
}

describe("the box on its own", () => {
  it("hands over pasted coordinates exactly, with no area", async () => {
    const onFound = vi.fn();
    renderWithIntl(<LocationFinder onFound={onFound} />);
    type("6.87821, 101.27191");
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(onFound).toHaveBeenCalledWith({ point: { lat: 6.87821, lon: 101.27191 }, area: null });
    expect(screen.getByRole("status").textContent).toBe(th.locationFinder.pinned);
  });

  it("finds a tambon by name and gives the area back, picked by its code", async () => {
    const onFound = vi.fn();
    renderWithIntl(<LocationFinder onFound={onFound} />);
    type("บานา");
    const result = await screen.findByText("ต.บานา");
    fireEvent.click(result);
    expect(onFound).toHaveBeenCalledTimes(1);
    const { point, area } = onFound.mock.calls[0]![0];
    expect(point).toEqual({ lat: 6.878, lon: 101.272 });
    expect(area).toMatchObject({ code: "940104", provinceTh: "ปัตตานี", from: "list" });
  });

  it("says a name is not in the list instead of inventing a place", async () => {
    const onFound = vi.fn();
    renderWithIntl(<LocationFinder onFound={onFound} />);
    type("กรุงเทพ");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(th.locationFinder.none),
    );
    expect(onFound).not.toHaveBeenCalled();
  });

  it("still takes coordinates when the list cannot be loaded, and says so for a name", async () => {
    areasOk = false;
    const onFound = vi.fn();
    renderWithIntl(<LocationFinder onFound={onFound} />);
    type("บานา");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(th.locationFinder.offline),
    );
    type("6.9, 101.3");
    await waitFor(() => expect(onFound).toHaveBeenCalledTimes(1));
    expect(onFound.mock.calls[0]![0].point).toEqual({ lat: 6.9, lon: 101.3 });
  });

  it("does not guess where a short map link leads", async () => {
    renderWithIntl(<LocationFinder onFound={vi.fn()} />);
    type("https://maps.app.goo.gl/abc123");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(th.locationFinder.shortLink),
    );
  });

  it("never sends what was typed anywhere but Jaga's own public list", async () => {
    renderWithIntl(<LocationFinder onFound={vi.fn()} />);
    type("บานา");
    await screen.findByText("ต.บานา");
    expect(calls.every((url) => url.startsWith("/api/geo/areas"))).toBe(true);
  });
});

describe("on the home screen's area chooser", () => {
  it("opens as a third way in, and a pasted position becomes the tambon it is in", async () => {
    const onChoose = vi.fn();
    renderWithIntl(<AreaChooser onChoose={onChoose} />);
    expect(screen.queryByPlaceholderText(th.locationFinder.placeholder)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: th.locationFinder.open }));
    type("6.87821, 101.27191");
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith(BANA));
    expect(calls.some((url) => url.startsWith("/api/geo/locate?lat=6.878210&lon=101.271910"))).toBe(
      true,
    );
  });

  it("chooses a tambon found by name directly, without asking where it is", async () => {
    const onChoose = vi.fn();
    renderWithIntl(<AreaChooser onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: th.locationFinder.open }));
    type("บานา");
    fireEvent.click(await screen.findByText("ต.บานา"));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ code: "940104" }));
    expect(calls.some((url) => url.startsWith("/api/geo/locate"))).toBe(false);
  });

  it("says Jaga does not cover a position outside the four provinces", async () => {
    located = { kind: "outside" };
    const onChoose = vi.fn();
    renderWithIntl(<AreaChooser onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: th.locationFinder.open }));
    type("13.75, 100.5");
    expect(await screen.findByText(th.home.area.outside)).toBeTruthy();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("can be left out, as the SOS screens do", () => {
    renderWithIntl(<AreaChooser onChoose={vi.fn()} withFinder={false} />);
    expect(screen.queryByRole("button", { name: th.locationFinder.open })).toBeNull();
  });
});

describe("over the SOS pin map", () => {
  it("passes a pasted position on exactly, even when the map itself cannot load", async () => {
    const onPick = vi.fn();
    renderWithIntl(
      <PinOnMap text={{ hint: "hint", failed: "map failed" }} picked={null} onPick={onPick} />,
    );
    type("6.87821, 101.27191");
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick).toHaveBeenCalledWith({ lat: 6.87821, lon: 101.27191 });
  });
});
