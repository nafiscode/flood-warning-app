"use client";

import { useFormatter, useLocale } from "next-intl";
import { localName } from "@/lib/places";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import { monitoring, type Feed, type Point } from "@/lib/monitoring";
import { useKeptRain } from "@/lib/use-rain";
import { GAUGES_SUMMARY_URL, type GaugeSummary } from "@/lib/map-data";
import { useFetched } from "@/lib/use-public";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { MonitoringCard } from "@/components/monitoring/MonitoringCard";
import { MonitoringDetail } from "@/components/monitoring/MonitoringDetail";
import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The live monitoring on the home screen (the owner, 17 Oct 2026): one card with the status in a
 * line, and the same detail the map's band holds behind a tap.
 *
 * The one thing it asks for that the home screen did not already have is the gauge counts, and
 * those come from the small counts-and-points answer rather than the whole station list, after
 * the page has gone quiet: the hero, the checklist and the SOS button must never wait behind a
 * background figure on a slow phone.
 *
 * The detail leaves out the person's own level, which the hero already carries a few inches
 * above: a second copy of the same badge would only invite a reader to wonder which is current.
 */
export type HomeMonitoringProps = {
  /** The person's own tambon codes: their area and their watched places. */
  myCodes: string[];
  /** Their own area as a point, for the rivers' distance filter. */
  myPoint: Point | null;
  /** The dam the home screen already picked, and whether it is on the person's own river. */
  dam: Dam | null;
  damsState: Feed<Dam>["state"];
  onMyRiver: boolean;
  /** The tambon of theirs the dam's river runs through, named. */
  damTambon: string | null;
  reports: readonly TambonReports[] | null;
  reportsState: Feed<readonly TambonReports[]>["state"];
  now: number;
};

export function HomeMonitoring(props: HomeMonitoringProps) {
  const locale = useLocale();
  const format = useFormatter();
  const tMonitoring = useTranslations("monitoring");
  const [open, setOpen] = useState(false);
  const gauges = useFetched<GaugeSummary>(GAUGES_SUMMARY_URL, { afterIdle: true });
  const rain = useKeptRain();

  const summary = monitoring({
    now: props.now,
    myCodes: props.myCodes,
    myPoint: props.myPoint,
    narrowed: false,
    gauges: { state: gauges.state, data: gauges.data?.gauges ?? null },
    dam: { state: props.damsState, data: props.dam },
    onMyRiver: props.onMyRiver,
    reports: { state: props.reportsState, data: props.reports },
    rain: { state: rain.state, data: rain.data },
  });

  const time = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);
  const damName = props.dam ? localName(props.dam.name, locale) : null;

  return (
    <MonitoringCard
      summary={summary}
      time={time}
      open={open}
      onToggle={() => setOpen((was) => !was)}
      place="home"
      detail={
        <MonitoringDetail
          summary={summary}
          scopeWords={{ myPlace: rain.place?.name ?? null }}
          damName={damName}
          damTambon={props.damTambon}
          rainPlace={rain.place?.name ?? null}
          time={time}
          place="home"
          now={props.now}
          gauges={gauges.data?.gauges ?? null}
          gaugeScope={
            props.myPoint ? tMonitoring("scope.nearMe") : tMonitoring("scope.fourProvinces")
          }
          weather={rain.weather}
          dam={props.dam}
        />
      }
    />
  );
}
