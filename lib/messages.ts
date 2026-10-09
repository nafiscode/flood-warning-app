import type { AbstractIntlMessages } from "next-intl";

type Messages = Record<string, AbstractIntlMessages>;

/**
 * Only the texts a page's interactive parts need go to the browser (slow 3G): the layout sends
 * the language switcher's, and each of these pages adds its own.
 */
function pick(messages: AbstractIntlMessages, namespaces: string[]): AbstractIntlMessages {
  return Object.fromEntries(namespaces.map((n) => [n, (messages as Messages)[n]!]));
}

export function homeMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return {
    ...pick(messages, ["home", "alert", "sos", "places", "hotlines"]),
    // The area chooser's province list.
    map: { province: all.map!.province! },
  };
}

/**
 * The SOS screens: their own text, the hotline names, the area chooser's (home.area and the
 * province list) for when GPS fails, and the report form's depth labels.
 */
export function sosMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return {
    ...pick(messages, ["sos", "report", "hotlines", "home"]),
    map: { province: all.map!.province! },
  };
}

export function reportMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["report", "sos", "hotlines"]);
}

export function mapMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["map", "home", "alert", "sos", "places", "hotlines"]);
}

/** The weather page: its own text, plus the attribution line Open-Meteo requires. */
export function weatherMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["weather", "attribution"]);
}

/**
 * The war room: its own text, plus two sets of words that already exist and must keep saying the
 * same thing on every screen - the vulnerability flags of the SOS form and its depth labels.
 */
export function warRoomMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return {
    ...pick(messages, ["warRoom"]),
    sos: { vulnerable: (all.sos as Messages).vulnerable! },
    report: { depths: (all.report as Messages).depths! },
  };
}

/** The impact dashboard (spec 16): its own text only. */
export function impactMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["impact"]);
}

/**
 * The layout, on every page: the language switcher's text and the few lines the weather chip in
 * the header needs. The weather page's own text is not sent with it, so a page that nobody opens
 * the weather from stays as small as it was.
 */
export function layoutMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  const weather = all.weather as { chip: AbstractIntlMessages; codes: AbstractIntlMessages };
  return {
    language: all.language!,
    weather: { chip: weather.chip, codes: weather.codes },
  };
}
