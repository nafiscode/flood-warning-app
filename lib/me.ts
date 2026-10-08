import type { Area } from "@/lib/area";

/** A place the person watches for someone else (spec 4.9), as the home screen shows it. */
export type WatchedPlace = {
  id: string;
  label: string;
  /** Null when the pin is outside the tambons Jaga covers. */
  area: Area | null;
  contactName: string | null;
  /** Only ever in memory: never written to the phone's storage. */
  contactPhone: string | null;
};

/** Answer of /api/me/places: the signed-in person's home and watched places. */
export type MyPlaces =
  { signedIn: false } | { signedIn: true; home: Area | null; places: WatchedPlace[] };

/** What may be kept on the phone for offline use: everything except phone numbers. */
export function withoutPhones(me: MyPlaces): MyPlaces {
  if (!me.signedIn) return me;
  return { ...me, places: me.places.map((p) => ({ ...p, contactPhone: null })) };
}
