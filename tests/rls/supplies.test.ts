/**
 * A14: requests for food, water and other essentials (spec 4.10).
 *
 * What these tests are really guarding:
 *  - a supply request is never refused, whatever it carries (safety rule 1);
 *  - it is offered to distributors and coordinators, and never rings a rescue team's alarm;
 *  - a rescue SOS is still built exactly as before, and a distributor is not in its queue;
 *  - a supply request turns into a rescue the moment its sender says so, by the button or by a
 *    plain SOS from the same phone, and goes straight into the rescue relay;
 *  - a delivery earns fewer points than a rescue.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let at: { lat: number; lon: number };

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
  at = (
    await rows<{ lat: number; lon: number }>(
      db,
      `select extensions.st_y(p) as lat, extensions.st_x(p) as lon
         from (select extensions.st_pointonsurface(geom) as p from tambons where code = $1) x`,
      [w.yala1],
    )
  )[0]!;
});
afterEach(async () => {
  await db.query("rollback");
});

type Sent = { sos_id: string; token: string | null; merged: boolean; status: string };
type Offer = { unit_id: string; tier: string; round: number; queue_pos: number };
type Case = {
  kind: string;
  needs: string[];
  needs_note: string | null;
  supplies_left: string | null;
  people_count: number | null;
  status: string;
};

/** A team of the given capabilities covering the test tambon. */
async function team(name: string, capabilities: string[]) {
  await asOwner(db);
  const user = await createUser(db, { name, role: "authority" });
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
       values ($1, $2, $3, $4::authority_capability[], 'verified') returning id`,
      [w.org, user, name, capabilities],
    )
  )[0]!.id;
  await db.query(
    "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
    [id, w.yala1],
  );
  return { user, id };
}

/** Send the way the app does, as a visitor with a device id of their own. */
async function send(
  kind: "rescue" | "supplies",
  extra: { device?: string; needs?: unknown; note?: string; left?: string; people?: number } = {},
): Promise<Sent> {
  await as(db, "anon");
  return (
    await rows<Sent>(
      db,
      `select * from submit_sos(p_lat => $1, p_lon => $2, p_device_id => $3, p_kind => $4,
                                p_needs => $5, p_needs_note => $6, p_supplies_left => $7,
                                p_people_count => $8)`,
      [
        at.lat,
        at.lon,
        extra.device ?? "supplies-test-device",
        kind,
        extra.needs ?? ["water", "food"],
        extra.note ?? null,
        extra.left ?? "none",
        extra.people ?? 4,
      ],
    )
  )[0]!;
}

const theCase = async (id: string) => {
  await asOwner(db);
  return (
    await rows<Case>(
      db,
      "select kind, needs, needs_note, supplies_left, people_count, status from sos_requests where id = $1",
      [id],
    )
  )[0]!;
};

const offers = async (id: string) => {
  await asOwner(db);
  return rows<Offer>(
    db,
    "select unit_id, tier, round, queue_pos from sos_offers where sos_id = $1 order by round, queue_pos",
    [id],
  );
};

describe("sending a request for food and water", () => {
  it("is stored with what was asked for, by a visitor with no account", async () => {
    const sent = await send("supplies", { needs: ["water", "baby"], note: "Milk for a baby" });
    expect(sent.token).toBeTruthy();
    expect(sent.merged).toBe(false);
    const c = await theCase(sent.sos_id);
    expect(c.kind).toBe("supplies");
    expect(c.needs).toEqual(["baby", "water"]);
    expect(c.needs_note).toBe("Milk for a baby");
    expect(c.supplies_left).toBe("none");
    expect(c.people_count).toBe(4);
  });

  it("is never refused for what it carries: unknown needs and a bad answer are dropped", async () => {
    const sent = await send("supplies", { needs: ["gold", "water", "water"], left: "plenty" });
    const c = await theCase(sent.sos_id);
    expect(c.needs).toEqual(["water"]);
    expect(c.supplies_left).toBeNull();
  });

  it("leaves a plain SOS a rescue, whatever word arrives as its kind", async () => {
    await as(db, "anon");
    const sent = (
      await rows<Sent>(
        db,
        "select * from submit_sos(p_lat => $1, p_lon => $2, p_device_id => 'plain', p_kind => 'nonsense')",
        [at.lat, at.lon],
      )
    )[0]!;
    expect((await theCase(sent.sos_id)).kind).toBe("rescue");
    // And the call the deployed app makes today, with none of the new parameters.
    const old = (
      await rows<Sent>(
        db,
        "select * from submit_sos(p_lat => $1, p_lon => $2, p_device_id => 'old-app')",
        [at.lat, at.lon],
      )
    )[0]!;
    expect((await theCase(old.sos_id)).kind).toBe("rescue");
  });
});

describe("who is asked", () => {
  it("asks the distributors first, then the coordinators, and never a rescue-only team", async () => {
    const coord = await team("Yala coordination", ["coordination"]);
    const food = await team("Yala food and water", ["supplies"]);
    const sent = await send("supplies");
    const queue = await offers(sent.sos_id);
    expect(queue.map((o) => [o.unit_id, o.tier])).toEqual([
      [food.id, "supplies"],
      [coord.id, "coordination"],
    ]);
    expect(queue.map((o) => o.unit_id)).not.toContain(w.yalaRescue.id);
  });

  it("does not put a distributor in the queue of a rescue SOS", async () => {
    const food = await team("Yala food and water", ["supplies"]);
    const sent = await send("rescue", { device: "rescue-device" });
    const queue = await offers(sent.sos_id);
    expect(queue.map((o) => o.unit_id)).toEqual([w.yalaRescue.id]);
    expect(queue.map((o) => o.unit_id)).not.toContain(food.id);
  });

  it("gives each team the longer window", async () => {
    await team("Yala food and water", ["supplies"]);
    const sent = await send("supplies");
    await asOwner(db);
    const now = (
      await rows<{ seconds: number }>(
        db,
        "select extract(epoch from (expires_at - offered_at))::integer as seconds from sos_offer_now($1)",
        [sent.sos_id],
      )
    )[0]!;
    expect(now.seconds).toBe(600);
  });

  it("is with the admins at once when no distributor or coordinator covers the place", async () => {
    const sent = await send("supplies");
    expect(await offers(sent.sos_id)).toHaveLength(0);
    // Still a stored, open request on the rescue team's board, which may take it.
    await as(db, { uid: w.yalaRescue.user });
    const board = await rows<{ sos_id: string; kind: string; needs: string[] }>(
      db,
      "select sos_id, kind, needs from authority_board(72)",
    );
    const mine = board.find((r) => r.sos_id === sent.sos_id)!;
    expect(mine.kind).toBe("supplies");
    expect(mine.needs).toEqual(["food", "water"]);
    const taken = await rows<{ taken: boolean }>(db, "select * from authority_accept_sos($1)", [
      sent.sos_id,
    ]);
    expect(taken[0]!.taken).toBe(false);
  });

  it("shows the board to covering teams only", async () => {
    const sent = await send("supplies");
    await as(db, { uid: w.songkhlaRescue.user });
    const board = await rows<{ sos_id: string }>(db, "select sos_id from authority_board(72)");
    expect(board.map((r) => r.sos_id)).not.toContain(sent.sos_id);
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from authority_board(72)");
  });
});

describe("when it gets worse", () => {
  it("turns into a rescue by the sender's button and starts the rescue relay", async () => {
    const food = await team("Yala food and water", ["supplies"]);
    const sent = await send("supplies");
    await as(db, { uid: food.user });
    await db.query("select * from authority_accept_sos($1)", [sent.sos_id]);

    await as(db, "anon");
    const status = await rows<{ sos_need_rescue: string }>(db, "select sos_need_rescue($1, $2)", [
      sent.sos_id,
      sent.token,
    ]);
    expect(status[0]!.sos_need_rescue).toBe("received");

    const c = await theCase(sent.sos_id);
    expect(c.kind).toBe("rescue");
    // What they asked for is still on the case, for whoever reaches them.
    expect(c.needs).toEqual(["food", "water"]);
    const queue = await offers(sent.sos_id);
    const last = queue.filter((o) => o.round === Math.max(...queue.map((q) => q.round)));
    expect(last.map((o) => [o.unit_id, o.tier])).toEqual([[w.yalaRescue.id, "rescue"]]);
    // The distributor's claim is set aside, and the change is in the access log.
    expect(
      await rows(db, "select 1 from sos_claims where sos_id = $1 and released_at is null", [
        sent.sos_id,
      ]),
    ).toHaveLength(0);
    expect(
      await rows(
        db,
        "select 1 from audit_log where action = 'supply_request_escalated' and entity_id = $1",
        [sent.sos_id],
      ),
    ).toHaveLength(1);
  });

  it("refuses the button to anyone without the case's token", async () => {
    const sent = await send("supplies");
    await as(db, "anon");
    await expectDenied(db, "select sos_need_rescue($1, 'wrong-token')", [sent.sos_id]);
    expect((await theCase(sent.sos_id)).kind).toBe("supplies");
  });

  it("turns into a rescue when the same phone sends a plain SOS", async () => {
    const first = await send("supplies", { device: "same-phone" });
    const second = await send("rescue", { device: "same-phone" });
    expect(second.merged).toBe(true);
    expect(second.sos_id).toBe(first.sos_id);
    expect((await theCase(first.sos_id)).kind).toBe("rescue");
  });

  it("stays a rescue when a supply request follows an SOS, and gains the needs", async () => {
    const first = await send("rescue", { device: "same-phone" });
    const second = await send("supplies", { device: "same-phone", needs: ["medicine"] });
    expect(second.merged).toBe(true);
    const c = await theCase(first.sos_id);
    expect(c.kind).toBe("rescue");
    expect(c.needs).toEqual(["medicine"]);
  });

  it("does nothing to a case that is already a rescue", async () => {
    const sent = await send("rescue", { device: "rescue-device" });
    const before = await offers(sent.sos_id);
    await as(db, "anon");
    await db.query("select sos_need_rescue($1, $2)", [sent.sos_id, sent.token]);
    expect(await offers(sent.sos_id)).toEqual(before);
  });
});

describe("a delivery", () => {
  it("earns 5 points and 1 a person once the sender confirms it", async () => {
    const food = await team("Yala food and water", ["supplies"]);
    const sent = await send("supplies", { people: 4 });
    await asOwner(db);
    const path = `${sent.sos_id}/proof/a.jpg`;
    await db.query("insert into storage.objects (bucket_id, name) values ('sos-media', $1)", [
      path,
    ]);
    await as(db, { uid: food.user });
    await db.query("select * from authority_accept_sos($1)", [sent.sos_id]);
    await db.query("select authority_complete_sos($1, $2, null)", [sent.sos_id, [path]]);
    await as(db, "anon");
    await db.query("select sos_close($1, $2, true, null)", [sent.sos_id, sent.token]);
    await asOwner(db);
    const got = await rows<{ unit_id: string; points: number; reason: string }>(
      db,
      "select unit_id, points, reason from hero_points where sos_id = $1",
      [sent.sos_id],
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.unit_id).toBe(food.id);
    expect(got[0]!.points).toBe(9);
    expect(got[0]!.reason).toContain("delivery confirmed");
  });
});

describe("the maps and the war room", () => {
  it("counts the distributors covering a tambon", async () => {
    await team("Yala food and water", ["supplies"]);
    await as(db, { uid: w.yalaRescue.user });
    const row = (
      await rows<{ rescue_units: number; supplies_units: number }>(
        db,
        "select rescue_units, supplies_units from coverage_summary() where tambon = $1",
        [w.yala1],
      )
    )[0]!;
    expect(row.supplies_units).toBe(1);
    expect(row.rescue_units).toBeGreaterThanOrEqual(1);
  });

  it("keeps a supply request out of the admins' count of unanswered rescue cases", async () => {
    await as(db, { uid: w.admin });
    const before = (
      await rows<{ sos_open: number }>(db, "select sos_open from admin_overview()")
    )[0]!;
    const sent = await send("supplies");
    await as(db, { uid: w.admin });
    const after = (
      await rows<{ sos_open: number }>(db, "select sos_open from admin_overview()")
    )[0]!;
    expect(after.sos_open).toBe(before.sos_open);
    const board = await rows<{ sos_id: string; kind: string; needs: string[] }>(
      db,
      "select sos_id, kind, needs from admin_sos_board(72)",
    );
    expect(board.find((r) => r.sos_id === sent.sos_id)!.kind).toBe("supplies");
  });

  it("tells the sender what kind of request theirs is", async () => {
    const sent = await send("supplies", { left: "today" });
    await as(db, "anon");
    const mine = (
      await rows<{ kind: string; needs: string[]; supplies_left: string }>(
        db,
        "select kind, needs, supplies_left from sos_timeline($1, $2)",
        [sent.sos_id, sent.token],
      )
    )[0]!;
    expect(mine).toEqual({ kind: "supplies", needs: ["food", "water"], supplies_left: "today" });
  });
});
