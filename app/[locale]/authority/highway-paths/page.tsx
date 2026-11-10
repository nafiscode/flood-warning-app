import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { HighwayPathsMap } from "@/components/authority/HighwayPathsMap";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, localePath } from "@/lib/auth";
import { hazardSourceUrl, tilesBase, type TileManifest } from "@/lib/hazard-layer";
import {
  ALL_CLASSES,
  CLASS_LOOK,
  chosenProvince,
  FLAGGED,
  LIMITS,
  mapSearchLink,
  NOTE_STATUSES,
  readMyPlanningProvinces,
  readRunStamp,
  readStretchBoard,
  reasonsFor,
  roadLabel,
  type PathClass,
  type StretchRow,
} from "@/lib/highway-paths";
import { PRIVATE_PAGE } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, buttonSecondary, card, hint, input, label, notice } from "@/lib/ui";
import { saveNote } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/highway-paths">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "highwayPaths" });
  return { title: t("title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

/**
 * Where a main highway may be holding flood water back (A19; science plan Module 8 part 2).
 *
 * The one page in Jaga written for an engineer. A provincial highway office or irrigation project
 * office, verified with the `planning` capability, opens its own province's flagged stretches of
 * main road: what the radar record over nine flood seasons shows on each side, where natural
 * drainage crosses the road, whether anything is mapped to carry it, and a place to write down
 * what they found when they went to look.
 *
 * What it is not, said here because it governs the whole file:
 *
 *   * **Not an alert and not a suggestion** (safety rule 2). Nothing on this page can raise a
 *     level, prefill a draft or send a notification. It is advice for an office.
 *   * **Not certain** (safety rule 8). Every list carries the four limits in full, and the wording
 *     never says a road blocks the flood - it says what the radar record looks like, and that it
 *     is to be checked on imagery and on the ground.
 *   * **Not public** (rule 6). It is behind the `planning` capability, province by province, and
 *     it holds no personal data at all.
 *
 * Who may see it is decided in the database, never here: `my_planning_provinces()` answers with
 * the provinces this account may read, and every read and download asks again.
 */
export default async function HighwayPathsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/authority/highway-paths">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) {
    redirect(
      `${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/highway-paths")}`,
    );
  }

  const t = await getTranslations("highwayPaths");
  const tNav = await getTranslations("nav");
  const format = await getFormatter();
  const supabase = await createClient();

  const mine = await readMyPlanningProvinces(supabase);
  if (mine.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <section className={card} data-highway-not-allowed="true">
          <h1 className="text-h3 font-bold text-jaga-ink">{t("notAllowed.title")}</h1>
          <p>{t("notAllowed.body")}</p>
          <Link href="/authority/register" className={buttonSecondary}>
            {t("notAllowed.register")}
          </Link>
        </section>
        <BackLink label={tNav("backHome")} />
      </div>
    );
  }

  const asked = typeof query.province === "string" ? query.province : undefined;
  const province = chosenProvince(mine, asked)!;
  const [rows, stamp] = await Promise.all([
    readStretchBoard(supabase, province.code),
    readRunStamp(supabase, province.code),
  ]);
  const saved = typeof query.saved === "string" ? query.saved : undefined;
  const failed = query.error === "note";

  // The page view, in the audit log like the other authority views (A19 item 1). It must never be
  // the reason the page fails to draw, so its result is not checked.
  await supabase.rpc("log_highway_paths_view", { p_province: province.code });

  const provinceName = locale === "th" ? province.nameTh : province.nameEn;
  const contact = process.env.CONTACT_EMAIL?.trim();
  const byClass = (klass: PathClass) => rows.filter((r) => r.klass === klass);
  const totalKm = rows.reduce((sum, r) => sum + r.km, 0);

  // The flood-hazard layer the sections are drawn over. Read here, on the server, the way the
  // public map's Dashboard reads it: a new tile file needs no deploy.
  const tiles = tilesBase();
  let manifest: TileManifest | null = null;
  if (tiles) {
    try {
      const response = await fetch(`${tiles}/manifest.json`, { next: { revalidate: 900 } });
      if (response.ok) manifest = (await response.json()) as TileManifest;
    } catch {
      manifest = null;
    }
  }

  const classNames = Object.fromEntries(
    ALL_CLASSES.map((k) => [k, t(`klass.${k}.name`)]),
  ) as Record<PathClass, string>;

  return (
    <div className="flex flex-col gap-5">
      <section className={card}>
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        <p>{t("lead")}</p>
        {/* Said before anything else on the page; the four limits follow under the map. */}
        <p className={notice} data-highway-not-alert="true">
          {t("notAlert")}
        </p>
        <p className="font-medium">
          {t("province")}: {provinceName}
        </p>
        {/* An admin reads all four; an office normally has one and is shown no chooser. */}
        {mine.length > 1 && (
          <nav className="flex flex-wrap gap-2" aria-label={t("provincePick")}>
            {mine.map((p) => (
              <Link
                key={p.code}
                href={{ pathname: "/authority/highway-paths", query: { province: p.code } }}
                data-province-pick={p.code}
                aria-current={p.code === province.code ? "page" : undefined}
                className={p.code === province.code ? buttonPrimary : buttonSecondary}
              >
                {locale === "th" ? p.nameTh : p.nameEn}
              </Link>
            ))}
          </nav>
        )}
        {/*
          * Three different things, and the office has to be able to tell them apart: nothing
          * loaded for this province at all (an admin's job), roads loaded but none of them
          * flagged (a real answer about their roads), or a list.
          */}
        {stamp ? (
          <>
            <p className={hint}>
              {t("counts", {
                lookFirst: byClass("look_first").length,
                worthALook: byClass("worth_a_look").length,
                km: format.number(totalKm, { maximumFractionDigits: 1 }),
              })}
            </p>
            <p className={hint}>{t("run", { runId: stamp.runId, date: stamp.runDate })}</p>
          </>
        ) : (
          <p className={hint} data-highway-empty="true">
            {t("empty")}
          </p>
        )}
      </section>

      {stamp !== null && (
        <section className={card} data-highway-mapcard="true">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("map.title")}</h2>
          <HighwayPathsMap
            province={province.code}
            hazardUrl={hazardSourceUrl(tiles, manifest)}
            text={{
              show: t("map.show"),
              hide: t("map.hide"),
              legend: t("map.legend"),
              legendNote: t("map.legendNote"),
              under: t("map.under"),
              loading: t("map.loading"),
              failed: t("map.failed"),
              classes: classNames,
            }}
          />
        </section>
      )}

      {/* The four limits, in full, with every list (safety rule 8). */}
      <section className={card} data-highway-limits="true">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("limits.title")}</h2>
        <ul className="flex list-disc flex-col gap-2 ps-6">
          {LIMITS.map((key) => (
            <li key={key} data-limit={key}>
              {t(`limits.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      {failed && (
        <p role="alert" className={notice}>
          {t("note.failed")}
        </p>
      )}

      {FLAGGED.map((klass) => {
        const group = byClass(klass);
        return (
          <section key={klass} className="flex flex-col gap-4" data-highway-group={klass}>
            <div className="flex flex-col gap-1">
              <h2 className="text-h3 font-bold text-jaga-ink">
                {classNames[klass]} ({group.length})
              </h2>
              <p className={hint}>{t(`klass.${klass}.lead`)}</p>
            </div>
            {group.length === 0 ? (
              <p className={hint}>{t("emptyNone")}</p>
            ) : (
              group.map((row) => (
                <Stretch
                  key={row.id}
                  row={row}
                  locale={locale}
                  province={province.code}
                  saved={saved === row.id}
                  t={t}
                  format={format}
                />
              ))
            )}
          </section>
        );
      })}

      {stamp !== null && (
        <section className={card} data-highway-downloads="true">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("download.title")}</h2>
          <p className={hint}>{t("download.hint")}</p>
          <div className="flex flex-wrap gap-3">
            <a
              href={`/api/authority/highway-paths?province=${province.code}&format=csv`}
              className={buttonSecondary}
              data-highway-download="csv"
            >
              {t("download.csv")}
            </a>
            <a
              href={`/api/authority/highway-paths?province=${province.code}&format=geojson`}
              className={buttonSecondary}
              data-highway-download="geojson"
            >
              {t("download.geojson")}
            </a>
          </div>
          <p className={hint}>{t("download.credit")}</p>
          {/* A19 item 4: a line for an office or a researcher who wants to check this with us.
              Dropped entirely when the project has no contact address, rather than printed empty
              (the same as /about and /how-it-works). */}
          {contact && <p className={hint}>{t("contact", { email: contact })}</p>}
        </section>
      )}

      <BackLink label={tNav("backHome")} />
    </div>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations<"highwayPaths">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

/** One stretch: where it is, what was found, the figures behind it, and the office's own note. */
function Stretch({
  row,
  locale,
  province,
  saved,
  t,
  format,
}: {
  row: StretchRow;
  locale: string;
  province: string;
  saved: boolean;
  t: Translate;
  format: Format;
}) {
  const road = roadLabel(row, locale);
  const reasons = reasonsFor(row);
  const look = CLASS_LOOK[row.klass];
  const n = (v: number | null, digits = 2) =>
    v === null ? "—" : format.number(v, { maximumFractionDigits: digits });

  return (
    <article className={card} data-highway-stretch={row.id}>
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            data-stretch-class={row.klass}
            className="inline-block w-8 shrink-0 rounded-full"
            style={{ backgroundColor: look.color, height: `${Math.max(3, look.width)}px` }}
          />
          <h3 className="text-h3 font-bold text-jaga-ink">
            {road.ref ? t("stretch.road", { ref: road.ref }) : t("stretch.roadNoRef")}
          </h3>
        </div>
        {road.name && <p className="font-medium">{road.name}</p>}
        <p>
          {t("stretch.where", {
            tambon: locale === "th" ? row.tambonTh : row.tambonEn,
            district: locale === "th" ? row.districtTh : row.districtEn,
          })}
        </p>
        <p className={hint}>
          {t("stretch.length", {
            km: format.number(row.km, { maximumFractionDigits: 1 }),
            sections: row.sections,
          })}{" "}
          · {t("stretch.code", { id: row.id })}
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <h4 className="font-medium text-jaga-ink">{t("stretch.reasonsTitle")}</h4>
        <ul className="flex list-disc flex-col gap-1 ps-6">
          {reasons.map((reason) => (
            <li key={reason.key} data-reason={reason.key}>
              {t(`reason.${reason.key}`, reason.values)}
            </li>
          ))}
        </ul>
        <p className={hint}>{t("reason.sideNote")}</p>
      </div>

      <details className="flex flex-col gap-2">
        <summary className="min-h-tap cursor-pointer font-medium text-jaga-ink">
          {t("stretch.figures")}
        </summary>
        <dl className="mt-2 flex flex-col gap-2">
          <Figure label={t("figure.score")} value={n(row.score, 3)} />
          <Figure
            label={t("figure.asymmetry")}
            value={row.asymmetry === null ? "—" : t("figure.points", { v: n(row.asymmetry * 100, 1) })}
          />
          <Figure
            label={t("figure.seasons")}
            value={t("figure.seasonsOf", { v: row.seasonsUpWetter, of: row.seasonsSeen })}
          />
          <Figure
            label={t("figure.seasonsDown")}
            value={t("figure.seasonsOf", { v: row.seasonsDownWetter, of: row.seasonsSeen })}
          />
          <Figure label={t("figure.persistence")} value={n(row.persistence, 4)} />
          <Figure label={t("figure.passes")} value={String(row.passesSeen)} />
          <Figure
            label={t("figure.crossingKm2")}
            value={row.crossingKm2 === null ? "—" : t("figure.km2", { v: n(row.crossingKm2, 1) })}
          />
          <Figure
            label={t("figure.opening")}
            value={
              row.crossingOpening === null
                ? t("figure.openingNone")
                : t("figure.metres", { v: n(row.crossingOpeningM, 0) })
            }
          />
          <Figure label={t("figure.sideDecided")} value={row.upstreamBy} />
        </dl>
      </details>

      <a
        href={mapSearchLink(row.lat, row.lon)}
        target="_blank"
        rel="noreferrer"
        className={buttonSecondary}
        data-highway-maplink={row.id}
      >
        {t("stretch.openMap")}
      </a>

      <form action={saveNote} className="flex flex-col gap-3" data-highway-note={row.id}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="province" value={province} />
        <input type="hidden" name="stretch" value={row.id} />
        <h4 className="font-medium text-jaga-ink">{t("note.title")}</h4>
        <p className={hint}>{t("note.hint")}</p>
        <label className={label} htmlFor={`status-${row.id}`}>
          {t("note.statusLabel")}
        </label>
        <select
          id={`status-${row.id}`}
          name="status"
          defaultValue={row.noteStatus ?? "not_looked"}
          className={input}
        >
          {NOTE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`note.status.${status}`)}
            </option>
          ))}
        </select>
        <label className={label} htmlFor={`note-${row.id}`}>
          {t("note.noteLabel")}
        </label>
        <textarea
          id={`note-${row.id}`}
          name="note"
          rows={3}
          maxLength={2000}
          defaultValue={row.note ?? ""}
          placeholder={t("note.placeholder")}
          className={input}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonPrimary}>
            {t("note.save")}
          </button>
          {saved && (
            <span role="status" className="font-medium text-jaga-teal-ink">
              {t("note.saved")}
            </span>
          )}
          <span className={hint}>
            {row.noteAt
              ? t("note.by", {
                  unit: row.noteUnit ?? "",
                  time: format.dateTime(new Date(row.noteAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Bangkok",
                  }),
                })
              : t("note.none")}
          </span>
        </div>
      </form>
    </article>
  );
}

function Figure({ label: name, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-jaga-line pb-1">
      <dt className={hint}>{name}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
