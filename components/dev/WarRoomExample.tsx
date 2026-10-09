"use client";

import { useState } from "react";
import { WarRoom, type WarRoomView } from "@/components/admin/WarRoom";
import { EXAMPLE_BOARD, EXAMPLE_MAP_DATA, EXAMPLE_PEOPLE } from "@/lib/war-room-examples";

/**
 * The war room with made-up cases, people and reports, for the owner to look at before there is
 * anything real in the database. The buttons are idle on purpose: there is nothing to assign, no
 * phone to reveal, and nothing to write to. The real page is /admin/war-room.
 */
export function WarRoomExample({ view: first }: { view: WarRoomView }) {
  const [view, setView] = useState<WarRoomView>(first);
  return (
    <WarRoom
      initial={EXAMPLE_BOARD}
      view={view}
      people={EXAMPLE_PEOPLE}
      mapData={EXAMPLE_MAP_DATA}
      panels={{ reveal: null, assign: null, history: null, form: null }}
      personReveal={null}
      path={null}
      pollUrl={null}
      onView={setView}
      actions={null}
      done={null}
      error={null}
    />
  );
}
