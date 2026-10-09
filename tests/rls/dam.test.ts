/**
 * A12 part 1: the dam on the map, its live figures, and the two tiers.
 *
 * Two lines are tested hardest here:
 *   * the geometry and the readings are public, because they are a river's shape and figures the
 *     operator already publishes - but the review queue is not, because showing a notice before
 *     a person has judged it would be code publishing an alert by the back door (safety rule 2);
 *   * the spike guard. The archive holds an impossible 1,944 m3/s hour, and that exact reading
 *     must not grade as a release.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;
const all = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  rows<T>(db, sql, params);

type Signal = {
  grade: "quiet" | "watchful" | "releasing";
  reasons: string[];
  awaiting: string[];
  outflow_cms: number | null;
  percent_full: number | null;
  rise_mcm_per_h: number | null;
  readings: number;
  stale: boolean;
};

/**
 * Put a run of readings on the dam, **newest last**, ahead of anything the feed holds so that
 * they are what the signal reads. Values are as ThaiWater publishes them: million m3 in that
 * hour. `clear` drops the real readings first, for the few tests that need a short history.
 */
async function readings(
  values: {
    storage?: number;
    level?: number;
    inflow?: number;
    released?: number;
    spilled?: number;
  }[],
  clear = false,
) {
  await asOwner(db);
  if (clear) await db.query("delete from dam_readings where dam_code = 'bang_lang'");
  for (const [i, v] of values.entries()) {
    await db.query(
      `insert into dam_readings (dam_code, observed_at, storage_mcm, level_m,
                                 inflow_mcm_h, released_mcm_h, spilled_mcm_h)
       values ('bang_lang', now() + make_interval(hours => $1), $2, $3, $4, $5, $6)
       on conflict (dam_code, observed_at) do update set
         storage_mcm = excluded.storage_mcm, level_m = excluded.level_m,
         inflow_mcm_h = excluded.inflow_mcm_h, released_mcm_h = excluded.released_mcm_h,
         spilled_mcm_h = excluded.spilled_mcm_h`,
      [
        i + 1,
        v.storage ?? 745,
        v.level ?? 99.5,
        v.inflow ?? 0.37,
        v.released ?? 0.37,
        v.spilled ?? 0,
      ],
    );
  }
}

const signal = () => one<Signal>("select * from dam_signal('bang_lang')");
const quiet = { storage: 745, released: 0.37, spilled: 0 };

describe("the dam and its path are public", () => {
  it("a visitor reads the dam", async () => {
    await as(db, "anon");
    const dam = await one<{ code: string; operator: string }>(
      "select code, operator from dams where code = 'bang_lang'",
    );
    expect(dam.operator).toBe("EGAT");
  });

  it("a visitor reads the reaches and the tambons the river runs through", async () => {
    await as(db, "anon");
    const reaches = await all<{ kind: string }>("select kind from dam_reaches");
    expect(reaches.length).toBeGreaterThan(5);
    const tambons = await all<{ via: string }>("select via from dam_tambons");
    expect(tambons.some((t) => t.via === "main")).toBe(true);
  });

  it("the map answer carries the limits of the geometry with it", async () => {
    await as(db, "anon");
    const map = await one<{ geometry_note: Record<string, unknown>; tambons: number }>(
      "select geometry_note, tambons from dam_map()",
    );
    // Safety rule 8: a layer never travels without what it does and does not say.
    expect(map.geometry_note.source).toBe("osm");
    expect(String(map.geometry_note.limits_en)).toMatch(/not how far/);
    expect(map.tambons).toBeGreaterThan(0);
  });

  it("a visitor reads the readings, because the operator publishes them", async () => {
    await readings([quiet, quiet]);
    await as(db, "anon");
    expect((await all("select * from dam_readings")).length).toBeGreaterThan(0);
  });

  it("nobody but the owner may change the geometry or the readings", async () => {
    // The privilege is revoked, not merely unpolicied: without that, an update with no policy
    // passes silently against nought rows instead of being refused.
    await as(db, "anon");
    expect(await expectDenied(db, "update dams set operator = 'nobody'")).toBe("42501");
    expect(
      await expectDenied(
        db,
        `insert into dam_readings (dam_code, observed_at, storage_mcm)
         values ('bang_lang', now(), 1)`,
      ),
    ).toBeTruthy();
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "delete from dam_reaches")).toBeTruthy();
  });

  it("a tambon on the river says so, and one off it says nothing", async () => {
    await as(db, "anon");
    const on = await one<{ code: string }>(
      `select t.tambon_code as code from dam_tambons t where t.via = 'main' limit 1`,
    );
    const found = await all("select * from dam_tambon_on_path($1)", [on.code]);
    expect(found).toHaveLength(1);
    // Songkhla is nowhere near the Pattani river.
    expect(await all("select * from dam_tambon_on_path($1)", [w.songkhla])).toHaveLength(0);
  });
});

describe("the grade names the rule that fired", () => {
  it("a quiet dam is quiet", async () => {
    await readings([quiet, quiet, quiet]);
    const s = await signal();
    expect(s.grade).toBe("quiet");
    expect(s.reasons).toEqual([]);
  });

  it("a spill for two readings is a release", async () => {
    await readings([quiet, { ...quiet, spilled: 1.0 }, { ...quiet, spilled: 2.33 }]);
    const s = await signal();
    expect(s.grade).toBe("releasing");
    expect(s.reasons).toContain("spilling");
    // 2.33 million m3 in an hour is about the January 2021 peak.
    expect(s.outflow_cms).toBeGreaterThan(600);
  });

  it("more water than the turbines can pass is a release even without a spill", async () => {
    await readings([quiet, { ...quiet, released: 1.2 }, { ...quiet, released: 1.2 }]);
    const s = await signal();
    expect(s.grade).toBe("releasing");
    expect(s.reasons).toContain("above_turbines");
  });

  it("storage above normal high is watchful, not a release", async () => {
    await readings([quiet, { ...quiet, storage: 1460 }, { ...quiet, storage: 1461 }]);
    const s = await signal();
    expect(s.grade).toBe("watchful");
    expect(s.reasons).toContain("above_normal_high");
  });

  it("a high inflow is watchful", async () => {
    await readings([quiet, { ...quiet, inflow: 2.0 }, { ...quiet, inflow: 2.0 }]);
    const s = await signal();
    expect(s.grade).toBe("watchful");
    expect(s.reasons).toContain("inflow_high");
  });

  it("the share full is measured against the full reservoir", async () => {
    await readings([
      { ...quiet, storage: 794.9 },
      { ...quiet, storage: 794.9 },
    ]);
    expect((await signal()).percent_full).toBeCloseTo(50, 0);
  });
});

describe("the spike guard", () => {
  it("the archive's impossible 1,944 m3/s hour does not grade as a release", async () => {
    // 7.0 million m3 in one hour, no spill: the reading of 26 Jun 2015.
    await readings([quiet, quiet, { ...quiet, released: 7.0 }]);
    const s = await signal();
    expect(s.grade).toBe("quiet");
    // It is still shown, and still says what it is waiting for. Nothing is hidden.
    expect(s.awaiting).toContain("release_unconfirmed");
    expect(s.outflow_cms).toBeGreaterThan(1900);
  });

  it("one reading above normal high waits for the next", async () => {
    await readings([quiet, quiet, { ...quiet, storage: 1460 }]);
    const s = await signal();
    expect(s.grade).toBe("quiet");
    expect(s.awaiting).toContain("watch_unconfirmed");
  });

  it("a release confirmed by the next reading does grade", async () => {
    await readings([quiet, { ...quiet, released: 7.0 }, { ...quiet, released: 7.0 }]);
    expect((await signal()).grade).toBe("releasing");
  });

  it("a rate of rise is never guessed from too little history", async () => {
    // With the feed's own readings in the table there is plenty of history, so this is the one
    // test that empties it: two readings cannot span the six-hour window.
    await readings([quiet, quiet], true);
    expect((await signal()).rise_mcm_per_h).toBeNull();
  });
});

describe("the review queue is not public", () => {
  async function raise(): Promise<string> {
    await asOwner(db);
    const { id } = await one<{ id: string }>(
      `insert into dam_notices (dam_code, observed_at, grade, reasons, figures)
       values ('bang_lang', now(), 'releasing', '{spilling}', '{"outflow_cms": 700}')
       returning id`,
    );
    return id;
  }

  it("a visitor and a signed-in person see no notice", async () => {
    await raise();
    await as(db, "anon");
    expect(await all("select * from dam_notices")).toHaveLength(0);
    await as(db, { uid: w.requester });
    expect(await all("select * from dam_notices")).toHaveLength(0);
  });

  it("an authority unit sees no notice either", async () => {
    await raise();
    await as(db, { uid: w.yalaRescue.user });
    expect(await all("select * from dam_notices")).toHaveLength(0);
  });

  it("an admin sees it", async () => {
    await raise();
    await as(db, { uid: w.admin });
    expect(await all("select * from dam_notices")).toHaveLength(1);
  });

  it("the admin board is admins only", async () => {
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select * from admin_dam_board()")).toBeTruthy();
    await as(db, { uid: w.yalaRescue.user });
    expect(await expectDenied(db, "select * from admin_dam_board()")).toBeTruthy();
    await as(db, { uid: w.admin });
    const board = await one<{ dam_code: string; tambons_main: number }>(
      "select * from admin_dam_board()",
    );
    expect(board.dam_code).toBe("bang_lang");
    expect(board.tambons_main).toBeGreaterThan(0);
  });

  it("nobody may call the hourly job", async () => {
    await as(db, "anon");
    expect(await expectDenied(db, "select dam_fetch()")).toBeTruthy();
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select dam_fetch()")).toBeTruthy();
  });
});

describe("reviewing a notice", () => {
  async function raise(): Promise<string> {
    await asOwner(db);
    return (
      await one<{ id: string }>(
        `insert into dam_notices (dam_code, observed_at, grade, reasons, figures)
         values ('bang_lang', now(), 'releasing', '{spilling}', '{}') returning id`,
      )
    ).id;
  }

  it("an admin records that they sent it, and the reveal is in the audit log", async () => {
    const id = await raise();
    await as(db, { uid: w.admin });
    const status = await one<{ admin_dam_notice_review: string }>(
      "select admin_dam_notice_review($1, 'sent', 'told the district')",
      [id],
    );
    expect(status.admin_dam_notice_review).toBe("sent");
    await asOwner(db);
    const log = await all("select * from audit_log where entity_id = $1", [id]);
    expect(log).toHaveLength(1);
  });

  it("an admin may dismiss it", async () => {
    const id = await raise();
    await as(db, { uid: w.admin });
    await db.query("select admin_dam_notice_review($1, 'dismissed')", [id]);
    await asOwner(db);
    const n = await one<{ status: string; reviewed_by: string }>(
      "select status, reviewed_by from dam_notices where id = $1",
      [id],
    );
    expect(n.status).toBe("dismissed");
    expect(n.reviewed_by).toBe(w.admin);
  });

  it("a review is either sent or dismissed, never something else", async () => {
    const id = await raise();
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select admin_dam_notice_review($1, 'ended')", [id]),
    ).toBeTruthy();
  });

  it("nobody but an admin may review", async () => {
    const id = await raise();
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select admin_dam_notice_review($1, 'sent')", [id])).toBeTruthy();
    await as(db, { uid: w.yalaRescue.user });
    expect(await expectDenied(db, "select admin_dam_notice_review($1, 'sent')", [id])).toBeTruthy();
  });

  it("a notice that is already dealt with cannot be reviewed twice", async () => {
    const id = await raise();
    await as(db, { uid: w.admin });
    await db.query("select admin_dam_notice_review($1, 'dismissed')", [id]);
    expect(await expectDenied(db, "select admin_dam_notice_review($1, 'sent')", [id])).toBeTruthy();
  });

  it("the feed's health is for admins, not for the public", async () => {
    await asOwner(db);
    await db.query("insert into dam_feed_log (ok, http_status, rows_stored) values (true, 200, 5)");
    await as(db, "anon");
    expect(await all("select * from dam_feed_log")).toHaveLength(0);
    await as(db, { uid: w.admin });
    expect((await all("select * from dam_feed_log")).length).toBeGreaterThan(0);
  });
});
