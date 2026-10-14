"use client";

import { usePathname } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { currentItem, plainPath, type AdminGroup } from "@/lib/admin-menu";

export type MenuItem = {
  key: string;
  href: string;
  label: string;
  waiting: string | null;
  waitingLabel: string | null;
};
export type MenuGroup = {
  key: AdminGroup;
  title: string;
  /** "3" when three wait in the group, null when none or the group counts nothing. */
  waiting: string | null;
  /** The same for a screen reader: "3 waiting". */
  waitingLabel: string | null;
  items: MenuItem[];
};

const chip =
  "flex h-full min-h-tap cursor-pointer list-none items-center justify-between gap-2 rounded-xl text-start border border-jaga-line bg-jaga-surface px-3 py-1 text-small font-medium text-jaga-ink hover:border-jaga-edge [&::-webkit-details-marker]:hidden";
const chipHere = "border-jaga-edge border-2";
const count =
  "inline-flex min-w-6 items-center justify-center rounded-full bg-jaga-slate px-1.5 text-small font-bold text-white";

/**
 * The admin console's menu: Home and four groups, each a native disclosure that opens a panel of
 * its pages under the row. Opening one closes the others (`name`, where the browser knows it),
 * and every page change closes them all - the key carries the address, so a new page draws the
 * menu shut. The group holding the current page is outlined; the page itself is marked.
 *
 * The panel sits under the hotline bar (z-10 in the layout), so the numbers to call stay one tap
 * away while a group is open (safety rule 4). On a phone the buttons are two to a row.
 *
 * The counts are how many wait for an admin, from the layout. They are slate, never an alert
 * colour: a queue is not a hazard level.
 */
export function AdminMenu({
  label,
  home,
  groups,
}: {
  label: string;
  home: string;
  groups: MenuGroup[];
}) {
  const pathname = usePathname();
  const here = currentItem(pathname);
  const onHome = plainPath(pathname) === "/admin";
  return (
    <nav
      aria-label={label}
      className="relative grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
      data-admin-menu
    >
      <Link
        href="/admin"
        aria-current={onHome ? "page" : undefined}
        className={`${chip} ${onHome ? chipHere : ""}`}
      >
        {home}
      </Link>
      {groups.map((g) => (
        <details
          key={`${g.key}:${pathname}`}
          name="jaga-admin-menu"
          className="group"
          data-admin-group={g.key}
        >
          <summary
            className={`${chip} ${here?.group === g.key ? chipHere : ""}`}
            data-here={here?.group === g.key ? "" : undefined}
          >
            <span className="inline-flex items-center gap-2">
              {g.title}
              {g.waiting && (
                <span className={count} data-admin-waiting={g.key}>
                  <span aria-hidden="true">{g.waiting}</span>
                  <span className="sr-only">{g.waitingLabel}</span>
                </span>
              )}
            </span>
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 -translate-y-0.5 rotate-45 border-e-2 border-b-2 border-jaga-ink transition-transform group-open:translate-y-0.5 group-open:-rotate-135"
            />
          </summary>
          <ul className="absolute inset-x-0 top-full z-[5] mt-2 grid list-none gap-1 rounded-2xl border border-jaga-line bg-jaga-surface p-2 shadow-lg sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((item) => {
              const current = here?.key === item.key;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    data-admin-link={item.key}
                    className={`flex min-h-tap items-center justify-between gap-2 rounded-xl px-3 py-2 text-jaga-ink hover:bg-jaga-ground ${current ? "font-bold underline" : ""}`}
                  >
                    {item.label}
                    {item.waiting && (
                      <span className={count}>
                        <span aria-hidden="true">{item.waiting}</span>
                        <span className="sr-only">{item.waitingLabel}</span>
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </nav>
  );
}
