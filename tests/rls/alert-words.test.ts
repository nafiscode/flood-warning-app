/**
 * A6: an alert carries its template's words beside the filled-in ones, so a screen can name the
 * reader's own place instead of the alert's whole list of tambons. The filled-in words stay.
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

describe("the template's words on a published alert", () => {
  it("are kept per language with their {area}, and the public answer carries them", async () => {
    await asOwner(db);
    const [tpl] = await rows<{ id: string }>(
      db,
      "select id from alert_templates where code = 'flood_watch'",
    );
    await as(db, { uid: w.admin });
    const [made] = await rows<{ id: string }>(db, "select admin_publish_alert($1, $2, $3) as id", [
      tpl!.id,
      [w.yala1, w.yala2],
      new Date(Date.now() + 3 * 3_600_000).toISOString(),
    ]);
    await as(db, "anon");
    const [seen] = await rows<{ messages: Record<string, string> }>(
      db,
      "select messages from public_alert_status() where alert_id = $1",
      [made!.id],
    );
    for (const locale of ["th", "ms", "en"]) {
      expect(seen!.messages[`template_${locale}`]).toContain("{area}");
      // The words for the record still name the area in full.
      expect(seen!.messages[locale]).not.toContain("{area}");
      expect(seen!.messages[locale]!.length).toBeGreaterThan(20);
    }
  });
});
