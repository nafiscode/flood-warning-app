"use client";

import { useEffect, useRef, useState } from "react";
import { checkBox, checkRow, errorNotice } from "@/lib/ui";

/** The tambons where the unit has an accepted case it is still working, and how many there. */
export type OpenCaseTambon = { tambon: string; name: string; count: number };

type Props = {
  openCases: OpenCaseTambon[];
  /** `body` holds {count} and {places}; they are filled in here as the form changes. */
  text: { body: string; confirm: string };
};

/** Only planning and dam work: an office, not a team in the field (A19, `unit_is_office_only`). */
const OFFICE_ONLY = new Set(["planning", "dam"]);

function ticked(form: ParentNode, name: string): Set<string> {
  return new Set(
    [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)].map(
      (i) => i.value,
    ),
  );
}

/** Tambon codes the form's area picker covers right now: single tambons, districts and provinces. */
function coveredCodes(form: ParentNode): Set<string> {
  const provinces = ticked(form, "province");
  const districts = ticked(form, "district");
  return new Set(
    [...form.querySelectorAll<HTMLInputElement>('input[name="tambon"]')]
      .filter(
        (i) =>
          i.checked || districts.has(i.value.slice(0, 4)) || provinces.has(i.value.slice(0, 2)),
      )
      .map((i) => i.value),
  );
}

/**
 * The question the admin is asked before a change that would cut a team off from a rescue it has
 * already accepted (owner, 26 Nov 2026). A team reads a case through its coverage and its
 * capabilities, accepted or not, so moving a tambon out of the area - or leaving the unit with
 * nothing but planning and dam work - hides that case from the people on their way to it.
 *
 * It watches the form as it is edited and shows itself only while it is true, with a box that
 * must be ticked to save. The ticked box is what tells the database to go ahead; the database
 * refuses without it, so a page without scripts is still stopped, only less politely.
 */
export function ScopeWarning({ openCases, text }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState<OpenCaseTambon[]>([]);

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form || openCases.length === 0) return;
    const check = () => {
      const caps = ticked(form, "capability");
      const office = caps.size > 0 && [...caps].every((c) => OFFICE_ONLY.has(c));
      const covered = coveredCodes(form);
      setCut(openCases.filter((c) => office || !covered.has(c.tambon)));
    };
    check();
    form.addEventListener("change", check);
    return () => form.removeEventListener("change", check);
  }, [openCases]);

  const count = cut.reduce((n, c) => n + c.count, 0);
  return (
    <div ref={root} data-scope-warning={cut.length > 0 ? "on" : "off"}>
      {cut.length > 0 && (
        <div role="alert" className={`${errorNotice} flex flex-col gap-2`}>
          <p className="font-medium">
            {text.body
              .replace("{count}", String(count))
              .replace("{places}", cut.map((c) => c.name).join(", "))}
          </p>
          <label className={checkRow}>
            <input type="checkbox" name="confirmOpen" value="yes" required className={checkBox} />
            <span>{text.confirm}</span>
          </label>
        </div>
      )}
    </div>
  );
}
