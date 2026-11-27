import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SosPhoneAsk } from "@/components/sos/SosPhoneAsk";
import { needNumberPayload } from "@/lib/push";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const ID = "11111111-1111-4111-8111-111111111111";

describe("the push that asks for a number", () => {
  it("opens the sender's own case page, in the phone's language, and carries nothing else", () => {
    for (const [locale, words, prefix] of [
      ["th", th.push.send, ""],
      ["ms", ms.push.send, "/ms"],
      ["en", en.push.send, "/en"],
    ] as const) {
      const p = needNumberPayload({ sos_id: ID, locale }, words)!;
      expect(p.url).toBe(`${prefix}/sos/${ID}`);
      expect(p.title).toBe(words.needNumberTitle);
      expect(p.tag).toBe(`need-number-${ID}`);
      expect(JSON.stringify(p).replaceAll(ID, "")).not.toMatch(/\d{8,}/);
    }
  });

  it("is nothing for a bad id or for words that are missing", () => {
    expect(needNumberPayload({ sos_id: "nope", locale: "th" }, th.push.send)).toBeNull();
    expect(needNumberPayload({ sos_id: ID, locale: "th" }, { somewhere: "x" })).toBeNull();
  });
});

describe("the card on the sender's case page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses something that is not a number, without sending anything", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container, getByText } = renderWithIntl(
      <SosPhoneAsk id={ID} token={null} onSaved={() => {}} />,
    );
    fireEvent.change(container.querySelector("input[type='tel']")!, { target: { value: "12" } });
    fireEvent.click(getByText(th.sos.phoneAsk.save));
    expect(container.textContent).toContain(th.sos.phoneAsk.invalid);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the number in international form with the case token, then says it is saved", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const { container, getByText } = renderWithIntl(
      <SosPhoneAsk id={ID} token="tok123" onSaved={onSaved} />,
    );
    fireEvent.change(container.querySelector("input[type='tel']")!, {
      target: { value: "081-234-5678" },
    });
    fireEvent.click(getByText(th.sos.phoneAsk.save));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/sos/${ID}`);
    expect(JSON.parse(init.body)).toEqual({
      action: "details",
      token: "tok123",
      phone: "+66812345678",
    });
    expect(init.headers["x-jaga-sos-token"]).toBe("tok123");
    expect(container.textContent).toContain(th.sos.phoneAsk.saved);
  });
});
