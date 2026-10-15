/**
 * An alert the automated alarm published by itself is marked as such in the public answer, so no
 * screen says an admin issued it; nothing else from the admins' snapshot (gauge, value, event) is
 * passed on.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, rows } from "./db";
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

describe("who issued an alert, in the public answer", () => {
  it("an auto-published alert says auto_alarm and nothing more; an admin's says nothing", async () => {
    await asOwner(db);
    await db.query("delete from alerts");
    const [auto] = await rows<{ id: string }>(
      db,
      `insert into alerts (hazard_type, level, reason, messages, issued_by, next_update_at, is_drill, signals_snapshot)
       values ('flood', 'warning', 'X.40A 16.1 m', '{"th":"ทดสอบ"}', $1, now() + interval '3 hours', false,
               '{"kind":"auto_alarm","gauge":"X.40A","value":16.1,"event":"e1","reviewed":false}')
       returning id`,
      [w.admin],
    );
    const [manual] = await rows<{ id: string }>(
      db,
      `insert into alerts (hazard_type, level, reason, messages, issued_by, next_update_at, is_drill)
       values ('flood', 'watch', 'ฝนตกหนัก', '{"th":"ทดสอบ"}', $1, now() + interval '3 hours', false)
       returning id`,
      [w.admin],
    );
    await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $3), ($2, $3)", [
      auto!.id,
      manual!.id,
      w.yala1,
    ]);
    await as(db, "anon");
    const got = await rows<{ alert_id: string; details: unknown }>(
      db,
      "select alert_id, details from public_alert_status()",
    );
    expect(got.find((r) => r.alert_id === auto!.id)?.details).toEqual({ kind: "auto_alarm" });
    expect(got.find((r) => r.alert_id === manual!.id)?.details).toBeNull();
  });
});
