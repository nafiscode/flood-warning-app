/**
 * A5: finishing a case (spec 5.4).
 *
 * What these tests are really guarding:
 *  - a team cannot report a rescue without a photo that really exists, and only the team that
 *    holds the case can report it;
 *  - the team's word does not close the case: the person's own answer does;
 *  - a person who says they have NOT been rescued gets their case back into the relay at once;
 *  - the fallback is closed until the waiting time has passed, closed to the team that reported
 *    the rescue, and needs a photo and a note of its own.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
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

type Case = { status: string; closed_at: Date | null };
const theCase = async () => {
  await asOwner(db);
  return one<Case>("select status, closed_at from sos_requests where id = $1", [w.yalaSos]);
};

/** A file in the private bucket, as an upload from a team's phone would leave it. */
async function proof(name = "a.jpg"): Promise<string> {
  await asOwner(db);
  const path = `${w.yalaSos}/proof/${name}`;
  await db.query("insert into storage.objects (bucket_id, name) values ('sos-media', $1)", [path]);
  return path;
}

async function accept() {
  await as(db, { uid: w.yalaRescue.user });
  await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
}

/** The team accepts and reports the rescue with one real photo. */
async function reportRescue(): Promise<string> {
  const path = await proof();
  await accept();
  await db.query("select authority_complete_sos($1, $2, $3)", [
    w.yalaSos,
    [path],
    "ส่งถึงศูนย์พักพิง",
  ]);
  return path;
}

/** A second verified rescue unit in the same tambon, run by somebody else. */
async function secondTeam() {
  await asOwner(db);
  const user = await createUser(db, { name: "Yala rescue two", role: "authority" });
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
       values ($1, $2, 'Yala rescue two', '{rescue}'::authority_capability[], 'verified') returning id`,
      [w.org, user],
    )
  )[0]!.id;
  await db.query(
    "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
    [id, w.yala1],
  );
  return { user, id };
}

async function reportedHoursAgo(hours: number) {
  await asOwner(db);
  await db.query(
    "update sos_claims set completed_at = now() - make_interval(hours => $2) where sos_id = $1 and released_at is null",
    [w.yalaSos, hours],
  );
}

describe("a team reports the rescue", () => {
  it("needs a photo", async () => {
    await accept();
    await expectDenied(db, "select authority_complete_sos($1, '{}'::text[], null)", [w.yalaSos]);
  });

  it("does not take a path nobody uploaded, or a file from outside the proof folder", async () => {
    await asOwner(db);
    const elsewhere = `${w.yalaSos}/photo-1.jpg`;
    await db.query("insert into storage.objects (bucket_id, name) values ('sos-media', $1)", [
      elsewhere,
    ]);
    await accept();
    await expectDenied(db, "select authority_complete_sos($1, $2, null)", [
      w.yalaSos,
      [`${w.yalaSos}/proof/never-uploaded.jpg`, elsewhere],
    ]);
  });

  it("is refused to a team that does not hold the case", async () => {
    const path = await proof();
    const other = await secondTeam();
    await accept();
    await as(db, { uid: other.user });
    await expectDenied(db, "select authority_complete_sos($1, $2, null)", [w.yalaSos, [path]]);
  });

  it("marks the case rescued but leaves it unconfirmed", async () => {
    const path = await reportRescue();
    const c = await theCase();
    expect(c.status).toBe("rescued");
    expect(c.closed_at).toBeNull();
    const claim = await one<{ completion_photos: string[]; completed_at: Date | null }>(
      "select completion_photos, completed_at from sos_claims where sos_id = $1 and released_at is null",
      [w.yalaSos],
    );
    expect(claim.completion_photos).toEqual([path]);
    expect(claim.completed_at).toBeInstanceOf(Date);
    // No confirmation exists yet, so nothing can be counted from this (spec 5.5).
    expect(
      await rows(db, "select 1 from rescue_confirmations where sos_id = $1", [w.yalaSos]),
    ).toHaveLength(0);
  });

  it("keeps an unconfirmed rescue on the board, and says how many photos it has", async () => {
    await reportRescue();
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '10 days' where id = $1",
      [w.yalaSos],
    );
    await as(db, { uid: w.yalaRescue.user });
    const row = await one<{ proof_count: number; can_confirm: boolean; closed_at: Date | null }>(
      "select proof_count, can_confirm, closed_at from authority_board(72) where sos_id = $1",
      [w.yalaSos],
    );
    expect(row.proof_count).toBe(1);
    expect(row.closed_at).toBeNull();
    // The team that reported it is never the one to confirm it.
    expect(row.can_confirm).toBe(false);
  });
});

describe("the person's own answer", () => {
  it("closes the case when they confirm", async () => {
    await reportRescue();
    await as(db, { uid: w.requester });
    const status = await one<{ sos_close: string }>("select sos_close($1, null, true, null)", [
      w.yalaSos,
    ]);
    expect(status.sos_close).toBe("rescued");
    const c = await theCase();
    expect(c.closed_at).toBeInstanceOf(Date);
    const conf = await rows<{ method: string }>(
      db,
      "select method from rescue_confirmations where sos_id = $1",
      [w.yalaSos],
    );
    expect(conf.map((r) => r.method)).toEqual(["requester"]);
  });

  it("puts the case back into the relay when they say they were not rescued", async () => {
    await reportRescue();
    await as(db, { uid: w.requester });
    const status = await one<{ sos_dispute_rescue: string }>(
      "select sos_dispute_rescue($1, null)",
      [w.yalaSos],
    );
    expect(status.sos_dispute_rescue).toBe("received");

    const c = await theCase();
    expect(c.status).toBe("received");
    expect(c.closed_at).toBeNull();
    // Nobody holds it, and the relay is asking again - the same team included.
    expect(
      await rows(db, "select 1 from sos_claims where sos_id = $1 and released_at is null", [
        w.yalaSos,
      ]),
    ).toHaveLength(0);
    const asked = await one<{ dispatch_unit: string | null }>(
      "select dispatch_unit from sos_offer_now($1)",
      [w.yalaSos],
    );
    expect(asked.dispatch_unit).toBe(w.yalaRescue.id);
    const log = await rows(
      db,
      "select 1 from audit_log where entity_id = $1 and action = 'rescue_disputed'",
      [w.yalaSos],
    );
    expect(log).toHaveLength(1);
  });

  it("is not somebody else's to give", async () => {
    await reportRescue();
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select sos_dispute_rescue($1, null)", [w.yalaSos]);
    await expectDenied(db, "select sos_close($1, null, true, null)", [w.yalaSos]);
  });

  it("can close a case whose team has arrived", async () => {
    // The A4 function listed the open statuses before "on_site" existed, so a sender with a team
    // at the door could not say "I'm safe now".
    await accept();
    await db.query("select authority_advance_sos($1, 'on_site')", [w.yalaSos]);
    await as(db, { uid: w.requester });
    const status = await one<{ sos_close: string }>("select sos_close($1, null, false, null)", [
      w.yalaSos,
    ]);
    expect(status.sos_close).toBe("safe_cancelled");
  });
});

describe("the fallback confirmation", () => {
  it("is closed while the person still has time to answer", async () => {
    await reportRescue();
    const other = await secondTeam();
    const path = await proof("b.jpg");
    await reportedHoursAgo(11);
    await as(db, { uid: other.user });
    await expectDenied(db, "select authority_confirm_rescue($1, $2, 'seen at the shelter')", [
      w.yalaSos,
      [path],
    ]);
  });

  it("lets a second team confirm after the waiting time, with a photo and a note", async () => {
    await reportRescue();
    const other = await secondTeam();
    const path = await proof("b.jpg");
    await reportedHoursAgo(13);

    await as(db, { uid: other.user });
    const board = await one<{ can_confirm: boolean }>(
      "select can_confirm from authority_board(72) where sos_id = $1",
      [w.yalaSos],
    );
    expect(board.can_confirm).toBe(true);
    await expectDenied(db, "select authority_confirm_rescue($1, $2, '  ')", [w.yalaSos, [path]]);
    await expectDenied(db, "select authority_confirm_rescue($1, '{}'::text[], 'seen')", [
      w.yalaSos,
    ]);
    await db.query("select authority_confirm_rescue($1, $2, 'seen at the shelter')", [
      w.yalaSos,
      [path],
    ]);

    const c = await theCase();
    expect(c.status).toBe("rescued");
    expect(c.closed_at).toBeInstanceOf(Date);
    const conf = await one<{ method: string; photos: string[] }>(
      "select method, photos from rescue_confirmations where sos_id = $1",
      [w.yalaSos],
    );
    expect(conf.method).toBe("second_authority");
    expect(conf.photos).toEqual([path]);
  });

  it("is never the reporting team's own to give", async () => {
    const path = await reportRescue();
    await reportedHoursAgo(13);
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select authority_confirm_rescue($1, $2, 'we did it')", [
      w.yalaSos,
      [path],
    ]);
  });

  it("is open to an admin, and closed to an ordinary account", async () => {
    await reportRescue();
    const path = await proof("c.jpg");
    await reportedHoursAgo(13);
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select authority_confirm_rescue($1, $2, 'me')", [w.yalaSos, [path]]);
    await as(db, { uid: w.admin });
    await db.query("select authority_confirm_rescue($1, $2, 'phoned the family')", [
      w.yalaSos,
      [path],
    ]);
    const conf = await one<{ method: string }>(
      "select method from rescue_confirmations where sos_id = $1",
      [w.yalaSos],
    );
    expect(conf.method).toBe("admin");
  });
});

describe("where a proof photo may be written", () => {
  const writable = async (path: string) =>
    (await one<{ ok: boolean }>("select sos_media_writable($1) as ok", [path])).ok;

  it("a covering team may write under proof/, a visitor and the sender may not", async () => {
    const path = `${w.yalaSos}/proof/x.jpg`;
    await as(db, { uid: w.yalaRescue.user });
    expect(await writable(path)).toBe(true);
    await as(db, { uid: w.requester });
    expect(await writable(path)).toBe(false);
    await as(db, "anon");
    expect(await writable(path)).toBe(false);
  });

  it("the sender's own window for their photos is unchanged", async () => {
    await as(db, "anon");
    expect(await writable(`${w.yalaSos}/photo-1.jpg`)).toBe(true);
  });
});
