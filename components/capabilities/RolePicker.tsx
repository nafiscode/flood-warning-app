"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { CAPABILITY_ROLES, roleFromHash, type CapabilityRole } from "@/lib/capabilities";

export type RoleChoice = {
  role: CapabilityRole;
  name: string;
  who: string;
  icon: ReactNode;
  panel: ReactNode;
};

const HASH_EVENT = "hashchange";

function subscribe(onChange: () => void) {
  window.addEventListener(HASH_EVENT, onChange);
  return () => window.removeEventListener(HASH_EVENT, onChange);
}
const readHash = () => window.location.hash;
const serverHash = () => "";

/**
 * "Who are you?" on the capabilities page: one role at a time, so a resident is not handed the
 * admins' tools to read through (the owner: easy to digest, not overwhelming). The choice lives in
 * the address (#team, #supplies, #admin), so Account, a tour or a message can link to one role,
 * and the back button never fights it. Every panel is in the page from the start (for search
 * engines, and for a phone that loaded the page and then lost its signal); the others are hidden.
 */
export function RolePicker({ choices, label }: { choices: RoleChoice[]; label: string }) {
  const hash = useSyncExternalStore(subscribe, readHash, serverHash);
  const current = roleFromHash(hash);
  const picker = useRef<HTMLDivElement>(null);

  // Opened from a link that names a role: bring the picker into view, under the frozen header.
  useEffect(() => {
    if (CAPABILITY_ROLES.some((r) => `#${r}` === window.location.hash)) {
      picker.current?.scrollIntoView({ block: "start" });
    }
  }, []);

  function choose(role: CapabilityRole) {
    const { pathname, search } = window.location;
    window.history.replaceState(
      null,
      "",
      `${pathname}${search}${role === "resident" ? "" : `#${role}`}`,
    );
    window.dispatchEvent(new Event(HASH_EVENT));
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        ref={picker}
        role="group"
        aria-label={label}
        className="grid scroll-mt-28 grid-cols-2 gap-2 lg:grid-cols-4"
        data-role-picker
      >
        {choices.map(({ role, name, who, icon }) => {
          const on = role === current;
          return (
            <button
              key={role}
              type="button"
              aria-pressed={on}
              aria-controls={`role-${role}`}
              onClick={() => choose(role)}
              data-role-choice={role}
              className={`flex min-h-tap flex-col items-start gap-1 rounded-2xl border-2 p-3 text-start transition-colors ${
                on
                  ? "border-jaga-teal-ink bg-jaga-teal-ink/10"
                  : "border-jaga-line bg-jaga-surface hover:border-jaga-teal-ink/60"
              }`}
            >
              <span
                className={`grid size-10 place-items-center rounded-xl ${
                  on ? "bg-jaga-teal-ink text-jaga-surface" : "bg-jaga-ground text-jaga-ink"
                }`}
              >
                {icon}
              </span>
              <span className="font-bold leading-snug text-jaga-ink">{name}</span>
              <span className="text-small leading-snug text-jaga-text-2">{who}</span>
            </button>
          );
        })}
      </div>
      {choices.map(({ role, panel }) => (
        <div key={role} id={`role-${role}`} hidden={role !== current} data-role-panel={role}>
          {panel}
        </div>
      ))}
    </div>
  );
}
