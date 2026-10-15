import { describe, expect, it } from "vitest";
import { AlertDetails } from "@/components/home/AlertHero";
import { alertWords, fillArea } from "@/lib/alert-words";
import { tambonName } from "@/lib/area";
import { toPublicAlert, type PublicAlert } from "@/lib/public-status";
import { alertPayload } from "@/lib/push";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const MESSAGES = {
  th: "เตือนภัยน้ำท่วมในพื้นที่ ต.บ่อยาง, ต.เขารูปช้าง, ต.เกาะแต้ว และอีก 374 ตำบล ยกของขึ้นที่สูง",
  ms: "Amaran banjir di Bo Yang, Khao Rup Chang, Ko Taeo dan 374 mukim lagi. Angkat barang.",
  template_th: "เตือนภัยน้ำท่วมในพื้นที่ {area} ยกของขึ้นที่สูง",
  template_ms: "Amaran banjir di {area}. Angkat barang.",
  template_en: "Flood warning for {area}. Lift belongings.",
};
const ALERT: PublicAlert = {
  id: "0b0e7c1e-0000-4000-8000-000000000021",
  hazard: "flood",
  level: "warning",
  reason: "ฝนตกหนัก",
  messages: MESSAGES,
  issuedAt: "2026-11-20T03:00:00Z",
  nextUpdateAt: "2026-11-20T09:00:00Z",
  onset: null,
  returnWindow: null,
  source: null,
  tambons: ["950101"],
  release: null,
};

describe("an alert's words for one reader", () => {
  it("name the reader's own tambon where the stored text lists the whole area", () => {
    const sateng = tambonName("th", { nameTh: "สะเตง", nameEn: "Sateng" });
    expect(alertWords(MESSAGES, "th", sateng)).toBe(
      "เตือนภัยน้ำท่วมในพื้นที่ ต.สะเตง ยกของขึ้นที่สูง",
    );
    expect(
      alertWords(MESSAGES, "ms", tambonName("ms", { nameTh: "สะเตง", nameEn: "Sateng" })),
    ).toBe("Amaran banjir di Sateng. Angkat barang.");
  });

  it("say 'your area' without doubling the Thai word for area", () => {
    expect(alertWords(MESSAGES, "th", th.alert.yourArea)).toBe(
      "เตือนภัยน้ำท่วมในพื้นที่ของคุณ ยกของขึ้นที่สูง",
    );
    expect(fillArea("Flood warning for {area}.", en.alert.yourArea)).toBe(
      "Flood warning for your area.",
    );
  });

  it("stay in Thai, template and all, when the reader's language has no reviewed text", () => {
    // No English stored text: Thai is shown, so the Thai template is the one filled.
    expect(alertWords(MESSAGES, "en", "ต.สะเตง")).toContain("ในพื้นที่ ต.สะเตง");
  });

  it("are the stored words for an alert with no template, or with no place to name", () => {
    const plain = { th: "ประตูระบายน้ำเปิดแล้ว", ms: "Pintu air dibuka." };
    expect(alertWords(plain, "ms", "Sateng")).toBe(plain.ms);
    expect(alertWords(plain, "en", "Sateng")).toBe(plain.th);
    expect(alertWords(MESSAGES, "th", "")).toBe(MESSAGES.th);
    expect(alertWords({}, "th", "ต.สะเตง")).toBe("");
  });
});

describe("where the words are shown", () => {
  it("the alert's details name the place they are shown for, not the other 376 tambons", () => {
    const { container } = renderWithIntl(<AlertDetails alert={ALERT} areaName="ต.สะเตง" />);
    expect(container.textContent).toContain("เตือนภัยน้ำท่วมในพื้นที่ ต.สะเตง ยกของขึ้นที่สูง");
    expect(container.textContent).not.toContain("บ่อยาง");
    expect(container.textContent).not.toContain("374");
  });

  it("the details say 'your area' when no place is given", () => {
    const { container } = renderWithIntl(<AlertDetails alert={ALERT} />, "en");
    // English has no stored text here, so Thai is shown, with the reader's own "your area".
    expect(container.textContent).not.toContain("374");
    expect(container.textContent).toContain(en.alert.yourArea);
  });

  it("a phone notification says 'your area'", () => {
    const level = () => "Amaran";
    const p = alertPayload(
      { id: ALERT.id, level: "warning", messages: MESSAGES },
      "ms",
      level,
      ms.alert.yourArea,
    )!;
    expect(p.body).toBe("Amaran banjir di kawasan anda. Angkat barang.");
    // Without the words for "your area" nothing is lost: the stored message stands.
    expect(
      alertPayload({ id: ALERT.id, level: "warning", messages: MESSAGES }, "ms", level)!.body,
    ).toBe(MESSAGES.ms);
  });
});

describe("who issued an alert", () => {
  it("an alert the automatic alarm published by itself never says an admin issued it", () => {
    const row = {
      alert_id: ALERT.id,
      hazard_type: "flood",
      level: "warning",
      reason: "X.40A 16.1 m",
      messages: MESSAGES,
      issued_at: ALERT.issuedAt,
      next_update_at: ALERT.nextUpdateAt,
      tambons: ["950101"],
      details: { kind: "auto_alarm" },
    };
    const auto = toPublicAlert(row)!;
    expect(auto.auto).toBe(true);
    expect(toPublicAlert({ ...row, details: null })!.auto).toBe(false);
    const { container } = renderWithIntl(<AlertDetails alert={auto} />);
    expect(container.textContent).toContain(th.home.issuerAuto);
    expect(container.textContent).not.toContain(th.home.issuer);
    const byAdmin = renderWithIntl(<AlertDetails alert={ALERT} />).container;
    expect(byAdmin.textContent).toContain(th.home.issuer);
    expect(byAdmin.textContent).not.toContain(th.home.issuerAuto);
  });
});
