import { describe, expect, it } from "vitest";
import {
  HATYAI_CAMS,
  HATYAI_SOURCE_URL,
  hatYaiCamImage,
  hatYaiCamNameKey,
  inHatYai,
} from "@/lib/hatyai-cams";

/*
 * The Hat Yai cameras are a third party's live frames (lib/hatyai-cams). These tests pin what keeps
 * them honest and bounded: the images come from the agency over https, a refresh gets a NEW frame
 * past the cache, and the window is offered in the Hat Yai basin only - never on a far-south gauge.
 */
describe("the Hat Yai cameras", () => {
  it("has a non-empty set, each camera https and uniquely coded", () => {
    expect(HATYAI_CAMS.length).toBeGreaterThan(0);
    const codes = new Set(HATYAI_CAMS.map((c) => c.code));
    expect(codes.size).toBe(HATYAI_CAMS.length);
    for (const cam of HATYAI_CAMS) {
      expect(cam.image).not.toBe("");
      expect(hatYaiCamImage(cam.image).startsWith("https://")).toBe(true);
    }
    expect(HATYAI_SOURCE_URL.startsWith("https://")).toBe(true);
  });

  it("builds the live JPEG url and busts the cache on refresh", () => {
    const plain = hatYaiCamImage("muangkong");
    expect(plain).toBe("https://hatyaicityclimate.org/floodphoto/last/muangkong.jpg");
    // A refresh passes a timestamp, which changes the url so the browser re-fetches the newest frame.
    const a = hatYaiCamImage("muangkong", 1000);
    const b = hatYaiCamImage("muangkong", 2000);
    expect(a).toContain("?t=1000");
    expect(a).not.toBe(b);
  });

  it("maps a code to its lower-case name key", () => {
    expect(hatYaiCamNameKey("S1")).toBe("s1");
  });

  it("offers the window in the Hat Yai basin only", () => {
    expect(inHatYai(7.0, 100.47)).toBe(true); // Hat Yai city
    expect(inHatYai(6.86, 101.28)).toBe(false); // Pattani
    expect(inHatYai(6.43, 101.82)).toBe(false); // Narathiwat
    expect(inHatYai(13.75, 100.5)).toBe(false); // Bangkok
  });
});
