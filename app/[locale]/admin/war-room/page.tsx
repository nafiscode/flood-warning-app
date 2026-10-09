import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { WarRoom, type WarRoomView } from "@/components/admin/WarRoom";
import type { CasePanels } from "@/components/admin/WarRoomCases";
import { localePath } from "@/lib/auth";
import {
  readBoard,
  readHistory,
  readMapData,
  readPeople,
  readUnits,
  revealPersonPhone,
  revealSosPhone,
} from "@/lib/admin-board";
import { warRoomMessages } from "@/lib/messages";
import { assignCase, judgeSpam, noteCase, releaseCase } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/war-room">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "warRoom" });
  return { title: t("title") };
}

/**
 * The admins' war room (spec 6.4). The layout above it has already turned away everyone who is
 * not an admin; every read and write below is checked again in the database, which is what
 * actually decides (safety rule 5).
 *
 * The page reads the board on the server and hands it to the client, which keeps it fresh by
 * itself. Whatever a panel in the address needs - a phone, the units for a case, a case's history
 * - is read here, so the browser never holds more than the screen is showing.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value : "";
const id = (value: string | string[] | undefined): string | null => {
  const v = one(value);
  return UUID.test(v) ? v : null;
};

export default async function WarRoomPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/war-room">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;

  const asked = one(query.view);
  const view: WarRoomView =
    asked === "people" || asked === "map" ? (asked as WarRoomView) : "cases";
  const reveal = id(query.reveal);
  const assign = id(query.assign);
  const history = id(query.case);
  const person = id(query.person);
  const release = id(query.release);
  const note = id(query.note);
  const spam = id(query.spam);
  const search = one(query.q).slice(0, 80);
  const offset = Math.max(0, Math.min(5000, Number(one(query.from)) || 0));

  const board = await readBoard();
  const openCase = (caseId: string | null) =>
    caseId ? (board.cases.find((c) => c.id === caseId) ?? null) : null;

  // Only what this screen is actually showing is read.
  const [people, mapData, phone, units, rows, personPhone] = await Promise.all([
    view === "people" ? readPeople(search, offset) : Promise.resolve(null),
    view === "map" || view === "people" ? readMapData() : Promise.resolve(null),
    reveal ? revealSosPhone(reveal) : Promise.resolve(null),
    assign ? readUnits(openCase(assign)?.tambon ?? null) : Promise.resolve([]),
    history ? readHistory(history) : Promise.resolve([]),
    person ? revealPersonPhone(person) : Promise.resolve(null),
  ]);

  const form: CasePanels["form"] = release
    ? { kind: "release", caseId: release }
    : note
      ? { kind: "note", caseId: note }
      : spam
        ? { kind: "spam", caseId: spam }
        : null;

  return (
    <NextIntlClientProvider messages={warRoomMessages(await getMessages())}>
      <WarRoom
        initial={board}
        view={view}
        people={people}
        mapData={mapData}
        panels={{
          reveal: reveal ? { caseId: reveal, phone } : null,
          assign: assign ? { caseId: assign, units } : null,
          history: history ? { caseId: history, rows } : null,
          form,
        }}
        personReveal={person ? { userId: person, phone: personPhone } : null}
        path={localePath(locale, "/admin/war-room")}
        pollUrl="/api/admin/war-room"
        actions={{
          assign: assignCase.bind(null, locale),
          release: releaseCase.bind(null, locale),
          note: noteCase.bind(null, locale),
          spam: judgeSpam.bind(null, locale),
        }}
        done={one(query.done) || null}
        error={one(query.error) || null}
      />
    </NextIntlClientProvider>
  );
}
