import { describe, expect, it } from "vitest";
import { alertPayload, type PushAlert } from "@/lib/push";
import {
  alertChannels,
  ALERT_CHANNELS,
  areaChoice,
  chosenTambons,
  drillAudience,
  DRILL_AUDIENCES,
  lineQuotaAfter,
  toPreview,
} from "@/lib/alert-console";
import { layoutMessages } from "@/lib/messages";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/**
 * A drill that is sent (A10, the owner on 20 Oct). The database does the deciding - these are
 * the pieces on this side of the wire: which audiences the form may name, what the area tick
 * comes to, and the one line a phone shows before anybody opens anything.
 */
describe("who a drill is sent to", () => {
  it("keeps only the four audiences, in their own order", () => {
    expect(drillAudience(["everyone", "admins"])).toEqual(["admins", "everyone"]);
    expect(drillAudience(["rescue", "rescue"])).toEqual(["rescue"]);
    expect(drillAudience(["nobody", "", "units"])).toEqual(["units"]);
    expect(drillAudience([])).toEqual([]);
  });

  it("has a word for every audience in all three languages", () => {
    for (const messages of [th, ms, en]) {
      const audience = messages.alertConsole.review.audience as Record<string, string>;
      for (const who of DRILL_AUDIENCES) {
        expect(audience[who]).toBeTruthy();
        expect(audience[`${who}Hint`]).toBeTruthy();
      }
    }
  });
});

describe("everywhere people use Jaga", () => {
  const ALL = ["940101", "940102", "950101"];

  it("adds the tambons people are in, and nothing when the tick is off", () => {
    const peopled = ["940102", "950101"];
    const choice = { provinces: [], districts: [], tambons: [], zones: [], people: true };
    expect(chosenTambons(ALL, choice, {}, peopled)).toEqual(["940102", "950101"]);
    expect(chosenTambons(ALL, { ...choice, people: false }, {}, peopled)).toEqual([]);
  });

  it("joins the other ticks rather than replacing them, and drops what is not a tambon", () => {
    const choice = { provinces: [], districts: ["9401"], tambons: [], zones: [], people: true };
    expect(chosenTambons(ALL, choice, {}, ["950101", "999999"])).toEqual([
      "940101",
      "940102",
      "950101",
    ]);
  });

  it("is read off the form as a tick", () => {
    const form = new FormData();
    form.append("people", "yes");
    expect(areaChoice((name) => form.getAll(name)).people).toBe(true);
    expect(areaChoice(() => []).people).toBe(false);
  });
});

describe("what the review step is told", () => {
  const BASE = {
    level: "warning",
    reason: "r",
    messages: { th: "ข้อความ" },
    tambons: 2,
    reach: { homes: 10, watched: 4, people: 12, push: 9, line: 5 },
    lineQuota: { used: 100, limit: 500 },
    overlaps: [],
  };

  it("carries the drill's own reach, and nothing when no audience is ticked", () => {
    expect(toPreview(BASE)!.drillReach).toBeNull();
    const sent = toPreview({ ...BASE, drillReach: { people: 3, push: 2, line: 1 } })!;
    expect(sent.drillReach).toEqual({ people: 3, push: 2, line: 1 });
  });

  it("counts the quota against what is about to be sent, not the area's head count", () => {
    // The alert would send 5 LINE messages; this drill sends 1, and that is what it spends.
    expect(lineQuotaAfter(toPreview(BASE)!)!.after).toBe(105);
    const sent = toPreview({ ...BASE, drillReach: { people: 3, push: 2, line: 1 } })!;
    expect(lineQuotaAfter(sent)!.after).toBe(101);
  });
});

describe("the notification a sent drill makes", () => {
  const levelName = (level: string) => `[${level}]`;
  const alert: PushAlert = {
    id: "a1",
    level: "warning",
    messages: { th: "ซ้อมระบบแจ้งเตือน นี่คือการซ้อมเท่านั้น" },
  };

  it("says it is a drill before it says the level", () => {
    const payload = alertPayload({ ...alert, drill: true }, "th", levelName, "", "ซ้อมระบบ")!;
    expect(payload.title).toBe("Jaga · ซ้อมระบบ · [warning]");
    // The level still travels, so the phone makes the sound the real one would make: that is
    // the whole point of sending a drill at all.
    expect(payload.level).toBe("warning");
  });

  it("leaves a real alert's notification exactly as it was", () => {
    expect(alertPayload(alert, "th", levelName, "", "ซ้อมระบบ")!.title).toBe("Jaga · [warning]");
  });

  /*
   * Only the text a page needs goes to the browser (slow 3G), and the bell is drawn by the
   * layout. Its subset carried the five level names but not the drill mark, so the owner was
   * shown ALERT.DRILL.TAG where the Thai word should have been (21 Oct). The keys existing in
   * the file is not enough: what matters is that they reach the island that draws the mark.
   */
  it("sends the drill mark to the bell, in all three languages", () => {
    for (const messages of [th, ms, en]) {
      const drill = (layoutMessages(messages as never) as Record<string, Record<string, Record<string, string>>>)
        .alert!.drill!;
      expect(drill.tag).toBeTruthy();
      expect(drill.note).toBeTruthy();
      expect(drill.why).toBeTruthy();
    }
  });

  it("has the drill word in all three languages", () => {
    expect(th.alert.drill.tag).toBeTruthy();
    expect(ms.alert.drill.tag).toBeTruthy();
    expect(en.alert.drill.tag).toBeTruthy();
    // Nothing in the mark may read as an instruction to act.
    for (const messages of [th, ms, en]) {
      expect(messages.alert.drill.note).toBeTruthy();
      expect(messages.alert.drill.why).toBeTruthy();
    }
  });
});

describe("the roads an alert travels", () => {
  const BASE = {
    level: "warning",
    reason: "r",
    messages: { th: "ข้อความ" },
    tambons: 2,
    reach: { homes: 10, watched: 4, people: 12, push: 9, line: 5 },
    lineQuota: { used: 100, limit: 500 },
    overlaps: [],
  };

  it("keeps only the two roads, in their own order", () => {
    expect(alertChannels(["line", "push"])).toEqual(["push", "line"]);
    expect(alertChannels(["sms", "push"])).toEqual(["push"]);
    expect(alertChannels([])).toEqual([]);
  });

  it("says nothing about the quota when LINE is left out", () => {
    const preview = toPreview(BASE)!;
    expect(lineQuotaAfter(preview, ALERT_CHANNELS)!.after).toBe(105);
    expect(lineQuotaAfter(preview, ["push"])).toBeNull();
    expect(lineQuotaAfter(preview, [])).toBeNull();
  });

  it("has a word for both roads in all three languages", () => {
    for (const messages of [th, ms, en]) {
      const channels = messages.alertConsole.review.channels as Record<string, string>;
      for (const road of ALERT_CHANNELS) {
        expect(channels[road]).toBeTruthy();
        expect(channels[`${road}Hint`]).toBeTruthy();
      }
      expect(channels.none).toBeTruthy();
    }
  });
});
