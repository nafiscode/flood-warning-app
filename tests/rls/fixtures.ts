import type { Client } from "pg";
import { asOwner, createUser, rows } from "./db";

export type World = Awaited<ReturnType<typeof buildWorld>>;

/**
 * A small world, created as the database owner inside the test's transaction:
 * - users: a requester, another user, admin, super admin
 * - authorities in Yala: verified rescue unit, verified planning-only unit, pending unit;
 *   and a verified unit in Songkhla
 * - SOS cases in Yala and Songkhla (with phones), a household in Yala, a report in Yala
 */
export async function buildWorld(db: Client) {
  await asOwner(db);
  const [yala1, yala2] = (
    await rows<{ code: string }>(
      db,
      "select code from tambons where province_code = '95' order by code limit 2",
    )
  ).map((r) => r.code) as [string, string];
  const [songkhla] = (
    await rows<{ code: string }>(
      db,
      "select code from tambons where province_code = '90' order by code limit 1",
    )
  ).map((r) => r.code) as [string];
  const pointIn = async (code: string) =>
    (
      await rows<{ wkt: string }>(
        db,
        "select extensions.st_astext(extensions.st_pointonsurface(geom)) as wkt from tambons where code = $1",
        [code],
      )
    )[0]!.wkt;
  const yalaPoint = await pointIn(yala1);
  const songkhlaPoint = await pointIn(songkhla);

  const requester = await createUser(db, { name: "requester", phone: "66811111111" });
  const otherUser = await createUser(db, { name: "other user", phone: "66822222222" });
  const admin = await createUser(db, { name: "admin", role: "admin" });
  const superAdmin = await createUser(db, { name: "super admin", role: "super_admin" });

  const org = (
    await rows<{ id: string }>(
      db,
      "insert into organizations (name, type, official_phone) values ('Yala Rescue Foundation', 'nonprofit', '073000000') returning id",
    )
  )[0]!.id;
  const publicOrg = (
    await rows<{ id: string }>(
      db,
      "insert into organizations (name, type, official_phone, public_contact_opt_in) values ('Songkhla Volunteers', 'volunteer', '074000000', true) returning id",
    )
  )[0]!.id;

  async function unit(
    name: string,
    orgId: string,
    status: string,
    capabilities: string[],
    tambons: string[],
    pocPhone: string,
  ) {
    const user = await createUser(db, { name, role: status === "verified" ? "authority" : "user" });
    const id = (
      await rows<{ id: string }>(
        db,
        `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
         values ($1, $2, $3, $4::authority_capability[], $5::authority_status) returning id`,
        [orgId, user, name, capabilities, status],
      )
    )[0]!.id;
    await db.query(
      "insert into authority_unit_contacts (unit_id, poc_name, poc_phone) values ($1, $2, $3)",
      [id, `${name} POC`, pocPhone],
    );
    for (const t of tambons) {
      await db.query(
        "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
        [id, t],
      );
    }
    return { user, id };
  }

  const yalaRescue = await unit("Yala rescue", org, "verified", ["rescue"], [yala1], "66830000001");
  const yalaPlanning = await unit(
    "Yala planning",
    org,
    "verified",
    ["planning"],
    [yala1],
    "66830000002",
  );
  const yalaPending = await unit(
    "Yala pending",
    org,
    "pending",
    ["rescue"],
    [yala1],
    "66830000003",
  );
  const songkhlaRescue = await unit(
    "Songkhla rescue",
    publicOrg,
    "verified",
    ["rescue"],
    [songkhla],
    "66830000004",
  );

  async function sos(
    requesterId: string | null,
    point: string,
    tambon: string,
    phone: string | null,
  ) {
    const id = (
      await rows<{ id: string }>(
        db,
        `insert into sos_requests (requester_id, point, tambon, people_count, vulnerable_flags, depth_ref)
         values ($1, extensions.st_geomfromtext($2, 4326), $3, 3, '{"elderly": true}', 'waist') returning id`,
        [requesterId, point, tambon],
      )
    )[0]!.id;
    if (phone)
      await db.query("insert into sos_contacts (sos_id, contact_phone) values ($1, $2)", [
        id,
        phone,
      ]);
    await db.query("insert into sos_review (sos_id, suspected_spam) values ($1, true)", [id]);
    return id;
  }
  const yalaSos = await sos(requester, yalaPoint, yala1, "66811111111");
  const songkhlaSos = await sos(null, songkhlaPoint, songkhla, "66899999999");

  await db.query(
    `insert into households (owner_id, point, tambon, size, vulnerable, contact_phone, consent_at)
     values ($1, extensions.st_geomfromtext($2, 4326), $3, 4, '{"bedridden": 1}', '66811111111', now())`,
    [requester, yalaPoint, yala1],
  );
  await db.query(
    `insert into reports (reporter_id, point, tambon, depth_ref) values ($1, extensions.st_geomfromtext($2, 4326), $3, 'knee')`,
    [otherUser, yalaPoint, yala1],
  );

  return {
    yala1,
    yala2,
    songkhla,
    yalaPoint,
    songkhlaPoint,
    requester,
    otherUser,
    admin,
    superAdmin,
    org,
    publicOrg,
    yalaRescue,
    yalaPlanning,
    yalaPending,
    songkhlaRescue,
    yalaSos,
    songkhlaSos,
  };
}
