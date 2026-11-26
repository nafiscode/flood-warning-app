/**
 * An admin edits a registered team (owner, 26 Nov 2026).
 *
 * What these tests guard:
 *  - only an admin can edit a team, in any of the three parts, and never through the table;
 *  - every change is in the audit log under the admin's own account, with the old and new value;
 *    the contact's name and phone and the office phone are the exception: the log says that they
 *    changed, never what they were (safety rule 5);
 *  - a new contact phone is never left looking confirmed: the flags are cleared, and a verified
 *    team's new number can only be saved once the admin says they called it;
 *  - a change that changes nothing writes nothing;
 *  - the coverage is replaced whole or not at all, and what a team reads follows it at once;
 *  - taking the 'dam' capability away unties the unit from its dams;
 *  - the unit's status is never touched.
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
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

const DETAILS = "select admin_update_unit_details($1, $2, $3, $4::org_type, $5, $6)";
const CONTACT = "select admin_update_unit_contact($1, $2, $3, $4)";
const SCOPE = "select admin_update_unit_scope($1, $2::authority_capability[], $3::jsonb)";

const detailsArgs = (unit: string, over: Partial<Record<string, unknown>> = {}) => {
  const v = {
    unitName: "Yala rescue",
    orgName: "Yala Rescue Foundation",
    orgType: "nonprofit",
    officialPhone: "073000000",
    optIn: false,
    ...over,
  };
  return [unit, v.unitName, v.orgName, v.orgType, v.officialPhone, v.optIn];
};

const audit = async (action: string, unit: string) =>
  rows<{ actor: string; details: Record<string, unknown> }>(
    db,
    "select actor, details from audit_log where action = $1 and entity_id = $2 order by ts",
    [action, unit],
  );

const statusOf = async (unit: string) =>
  (
    await rows<{ status: string }>(db, "select status from authority_units where id = $1", [unit])
  )[0]!.status;

const contactOf = async (unit: string) =>
  (
    await rows<{
      poc_name: string;
      poc_phone: string;
      poc_phone_verified: boolean;
      poc_phone_verified_by_call: boolean;
    }>(
      db,
      "select poc_name, poc_phone, poc_phone_verified, poc_phone_verified_by_call from authority_unit_contacts where unit_id = $1",
      [unit],
    )
  )[0]!;

const tambonsOf = async (unit: string) =>
  (
    await rows<{ tambon: string }>(
      db,
      "select tambon from authority_coverage where unit_id = $1 order by tambon",
      [unit],
    )
  ).map((r) => r.tambon);

describe("who may edit a team", () => {
  it("only an admin, in all three parts", async () => {
    const unit = w.yalaRescue.id;
    const callers = ["anon", { uid: w.yalaRescue.user }, { uid: w.requester }] as const;
    for (const caller of callers) {
      await as(db, caller);
      const who = JSON.stringify(caller);
      expect(
        await expectDenied(db, DETAILS, detailsArgs(unit, { unitName: "Hijacked" })),
        who,
      ).toBe("42501");
      expect(await expectDenied(db, CONTACT, [unit, "Someone", "+66800000000", true]), who).toBe(
        "42501",
      );
      expect(
        await expectDenied(db, SCOPE, [
          unit,
          ["rescue"],
          JSON.stringify([{ level: "province", code: "90" }]),
        ]),
        who,
      ).toBe("42501");
    }
    await asOwner(db);
    expect((await contactOf(unit)).poc_name).toBe("Yala rescue POC");
    expect(
      (
        await rows<{ unit_name: string }>(
          db,
          "select unit_name from authority_units where id = $1",
          [unit],
        )
      )[0]!.unit_name,
    ).toBe("Yala rescue");
  });

  it("a team cannot rewrite its own coverage or contact through the tables once verified", async () => {
    await as(db, { uid: w.yalaRescue.user });
    // No policy lets a verified team remove its coverage: the delete matches no row.
    const removed = await db.query("delete from authority_coverage where unit_id = $1", [
      w.yalaRescue.id,
    ]);
    expect(removed.rowCount).toBe(0);
    // And the contact only accepts a write while the unit is pending.
    expect(
      await expectDenied(
        db,
        "update authority_unit_contacts set poc_phone = '+66899999999' where unit_id = $1",
        [w.yalaRescue.id],
      ),
    ).toBe("42501");
    await asOwner(db);
    expect((await tambonsOf(w.yalaRescue.id)).length).toBe(1);
    expect((await contactOf(w.yalaRescue.id)).poc_phone).toBe("66830000001");
  });
});

describe("unit and organization", () => {
  it("renames the unit and its organization, and logs the old and new value", async () => {
    const unit = w.yalaRescue.id;
    await as(db, { uid: w.admin });
    await db.query(
      DETAILS,
      detailsArgs(unit, {
        unitName: "  Yala rescue boats  ",
        orgName: "Yala Rescue Association",
        orgType: "government",
        optIn: true,
        officialPhone: "073-111-222",
      }),
    );
    await asOwner(db);
    const got = (
      await rows<{ unit_name: string; name: string; type: string; phone: string; opt: boolean }>(
        db,
        `select u.unit_name, o.name, o.type, o.official_phone as phone, o.public_contact_opt_in as opt
           from authority_units u join organizations o on o.id = u.org_id where u.id = $1`,
        [unit],
      )
    )[0]!;
    expect(got).toEqual({
      unit_name: "Yala rescue boats",
      name: "Yala Rescue Association",
      type: "government",
      phone: "073111222",
      opt: true,
    });
    const log = await audit("admin_edit_unit_details", unit);
    expect(log).toHaveLength(1);
    expect(log[0]!.actor).toBe(w.admin);
    expect(log[0]!.details).toMatchObject({
      changes: {
        unit_name: { from: "Yala rescue", to: "Yala rescue boats" },
        org_name: { from: "Yala Rescue Foundation", to: "Yala Rescue Association" },
        org_type: { from: "nonprofit", to: "government" },
        public_contact_opt_in: { from: false, to: true },
        official_phone_changed: true,
      },
      units_in_organization: 3,
    });
    // An office number can be somebody's own mobile: the log says it changed, never what it was.
    expect(JSON.stringify(log[0]!.details)).not.toContain("073");
    // The organization is shared, so the other units under it carry the new name too.
    expect(
      (
        await rows<{ n: string }>(
          db,
          "select o.name as n from authority_units u join organizations o on o.id = u.org_id where u.id = $1",
          [w.yalaPlanning.id],
        )
      )[0]!.n,
    ).toBe("Yala Rescue Association");
    expect(await statusOf(unit)).toBe("verified");
  });

  it("changes nothing and logs nothing when nothing changed", async () => {
    await as(db, { uid: w.admin });
    await db.query(DETAILS, detailsArgs(w.yalaRescue.id));
    await asOwner(db);
    expect(await audit("admin_edit_unit_details", w.yalaRescue.id)).toHaveLength(0);
  });

  it("refuses a name that is too short and a phone that is not one", async () => {
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, DETAILS, detailsArgs(w.yalaRescue.id, { unitName: "x" }))).toBe(
      "23514",
    );
    expect(await expectDenied(db, DETAILS, detailsArgs(w.yalaRescue.id, { orgName: " " }))).toBe(
      "23514",
    );
    expect(
      await expectDenied(db, DETAILS, detailsArgs(w.yalaRescue.id, { officialPhone: "call me" })),
    ).toBe("23514");
    expect(
      await expectDenied(db, DETAILS, detailsArgs("00000000-0000-4000-8000-000000000000")),
    ).toBe("P0002");
  });

  it("works on a team that is still waiting", async () => {
    await as(db, { uid: w.admin });
    await db.query(DETAILS, detailsArgs(w.yalaPending.id, { unitName: "Yala pending boats" }));
    await asOwner(db);
    expect(await statusOf(w.yalaPending.id)).toBe("pending");
    expect(await audit("admin_edit_unit_details", w.yalaPending.id)).toHaveLength(1);
  });
});

describe("the contact", () => {
  it("a verified team's new number needs the call, and is then unconfirmed by OTP", async () => {
    const unit = w.yalaRescue.id;
    await db.query(
      "update authority_unit_contacts set poc_phone_verified = true where unit_id = $1",
      [unit],
    );
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, CONTACT, [unit, "Yala rescue POC", "+66811112222", false])).toBe(
      "23514",
    );
    await asOwner(db);
    // The refused save left everything as it was, flags included.
    expect(await contactOf(unit)).toMatchObject({
      poc_phone: "66830000001",
      poc_phone_verified: true,
    });

    await as(db, { uid: w.admin });
    await db.query(CONTACT, [unit, " New Person ", "+66811112222", true]);
    await asOwner(db);
    expect(await contactOf(unit)).toEqual({
      poc_name: "New Person",
      poc_phone: "+66811112222",
      poc_phone_verified: false,
      poc_phone_verified_by_call: true,
    });
    const log = await audit("admin_edit_unit_contact", unit);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actor: w.admin,
      details: { name_changed: true, phone_changed: true, phone_confirmed_by_call: true },
    });
    // Personal data: the log never holds the name or either number.
    const text = JSON.stringify(log[0]!.details);
    for (const secret of ["New Person", "Yala rescue POC", "66811112222", "66830000001"]) {
      expect(text).not.toContain(secret);
    }
    expect(await statusOf(unit)).toBe("verified");
  });

  it("a name alone needs no call, and leaves the phone confirmation as it was", async () => {
    const unit = w.yalaRescue.id;
    await db.query(
      "update authority_unit_contacts set poc_phone_verified = true where unit_id = $1",
      [unit],
    );
    await as(db, { uid: w.admin });
    await db.query(CONTACT, [unit, "Corrected Name", "66830000001", false]);
    await asOwner(db);
    expect(await contactOf(unit)).toMatchObject({
      poc_name: "Corrected Name",
      poc_phone: "66830000001",
      poc_phone_verified: true,
    });
    expect((await audit("admin_edit_unit_contact", unit))[0]!.details).toMatchObject({
      name_changed: true,
      phone_changed: false,
      phone_confirmed_by_call: false,
    });
  });

  it("on a team still waiting, a new number is saved unconfirmed, to be called before approval", async () => {
    const unit = w.yalaPending.id;
    await as(db, { uid: w.admin });
    await db.query(CONTACT, [unit, "Yala pending POC", "+66822223333", false]);
    await asOwner(db);
    expect(await contactOf(unit)).toMatchObject({
      poc_phone: "+66822223333",
      poc_phone_verified: false,
      poc_phone_verified_by_call: false,
    });
    // And verification still refuses until the call is confirmed.
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select verify_authority_unit($1, false)", [unit])).toBe("23514");
  });

  it("changes nothing and logs nothing when nothing changed; refuses a bad name or phone", async () => {
    const unit = w.yalaRescue.id;
    await as(db, { uid: w.admin });
    await db.query(CONTACT, [unit, "Yala rescue POC", "66830000001", false]);
    expect(await expectDenied(db, CONTACT, [unit, "x", "66830000001", true])).toBe("23514");
    expect(await expectDenied(db, CONTACT, [unit, "Someone", "12-34", true])).toBe("23514");
    await asOwner(db);
    expect(await audit("admin_edit_unit_contact", unit)).toHaveLength(0);
  });
});

describe("capabilities and coverage", () => {
  const province = (code: string) => JSON.stringify([{ level: "province", code }]);

  it("replaces the coverage whole, logs both selections, and the team reads what its new area holds", async () => {
    const unit = w.yalaRescue;
    await as(db, { uid: unit.user });
    expect(
      (await rows<{ id: string }>(db, "select id from sos_requests")).map((r) => r.id),
    ).toEqual([w.yalaSos]);

    await as(db, { uid: w.admin });
    await db.query(SCOPE, [unit.id, ["rescue", "coordination"], province("90")]);
    await asOwner(db);

    const after = await tambonsOf(unit.id);
    expect(after.length).toBeGreaterThan(1);
    expect(after.every((c) => c.startsWith("90"))).toBe(true);
    expect(
      await rows<{ selected_code: string }>(
        db,
        "select distinct selected_code from authority_coverage where unit_id = $1",
        [unit.id],
      ),
    ).toEqual([{ selected_code: "90" }]);
    expect(
      (
        await rows<{ capabilities: string[] }>(
          db,
          "select capabilities::text[] as capabilities from authority_units where id = $1",
          [unit.id],
        )
      )[0]!.capabilities,
    ).toEqual(["coordination", "rescue"]);

    // What the team may read followed its area at once: Songkhla's case now, Yala's no longer.
    await as(db, { uid: unit.user });
    expect(
      (await rows<{ id: string }>(db, "select id from sos_requests")).map((r) => r.id),
    ).toEqual([w.songkhlaSos]);
    await asOwner(db);

    const log = await audit("admin_edit_unit_scope", unit.id);
    expect(log).toHaveLength(1);
    expect(log[0]!.actor).toBe(w.admin);
    expect(log[0]!.details).toMatchObject({
      changes: {
        capabilities: { from: ["rescue"], to: ["coordination", "rescue"] },
        coverage: {
          from: [{ level: "tambon", code: expect.any(String) }],
          to: [{ level: "province", code: "90" }],
          tambons_from: 1,
          tambons_to: after.length,
        },
      },
    });
    expect(await statusOf(unit.id)).toBe("verified");
  });

  it("is all or nothing: an empty or foreign area leaves the old coverage in place", async () => {
    const unit = w.yalaRescue.id;
    const before = await tambonsOf(unit);
    await as(db, { uid: w.admin });
    // Province 00 is not one Jaga covers: it expands to no tambons at all.
    expect(await expectDenied(db, SCOPE, [unit, ["rescue"], province("00")])).toBe("23514");
    expect(await expectDenied(db, SCOPE, [unit, ["rescue"], "[]"])).toBe("23514");
    expect(await expectDenied(db, SCOPE, [unit, ["rescue"], null])).toBe("23514");
    expect(await expectDenied(db, SCOPE, [unit, [], province("95")])).toBe("23514");
    await asOwner(db);
    expect(await tambonsOf(unit)).toEqual(before);
    expect(await audit("admin_edit_unit_scope", unit)).toHaveLength(0);
  });

  it("logs nothing when the capabilities and the tambons are the same", async () => {
    const unit = w.yalaRescue.id;
    const [only] = await tambonsOf(unit);
    await as(db, { uid: w.admin });
    await db.query(SCOPE, [unit, ["rescue"], JSON.stringify([{ level: "tambon", code: only }])]);
    await asOwner(db);
    expect(await tambonsOf(unit)).toEqual([only]);
    expect(await audit("admin_edit_unit_scope", unit)).toHaveLength(0);
  });

  it("taking 'dam' away unties the unit from its dams, and says so in the log", async () => {
    const unit = w.yalaRescue.id;
    const dam = (
      await rows<{ code: string }>(db, "select code from dams order by code limit 1")
    )[0]!.code;
    await as(db, { uid: w.admin });
    await db.query(SCOPE, [unit, ["rescue", "dam"], province("95")]);
    await db.query("select admin_link_dam_operator($1, $2)", [unit, dam]);
    await asOwner(db);
    expect(
      await rows(db, "select 1 from dam_operator_units where unit_id = $1", [unit]),
    ).toHaveLength(1);

    await as(db, { uid: w.admin });
    await db.query(SCOPE, [unit, ["rescue"], province("95")]);
    await asOwner(db);
    expect(
      await rows(db, "select 1 from dam_operator_units where unit_id = $1", [unit]),
    ).toHaveLength(0);
    const untied = await audit("dam_operator_unlinked", unit);
    // One for the admin's own untie-by-hand would be a different action; this one is the removal.
    expect(
      untied.some((e) => (e.details as { because?: string }).because === "dam capability removed"),
    ).toBe(true);
  });
});
