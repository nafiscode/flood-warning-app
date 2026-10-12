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
  const dam = all.dam as Messages;
  return {
    ...pick(messages, ["home", "alert", "sos", "places", "hotlines", "install"]),
    // The area chooser's province list.
    map: { province: all.map!.province! },
    /*
     * The quiet dam notice, for someone on the river below the dam (spec section 15). Only the
     * four groups that notice uses: its card, its legend and the names on the map marks stay
     * with the map page, because the home screen is the one screen with a slow-3G budget.
     */
    dam: {
      notice: dam.notice!,
      figures: dam.figures!,
      disclaimer: dam.disclaimer!,
      source: dam.source!,
    },
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

/** The "put Jaga on your home screen" card, where it stands by itself (the Account page). */
export function installMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["install"]);
}

export function reportMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["report", "sos", "hotlines"]);
}

export function mapMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  // "dam" comes with the map because the dam is drawn in every view (spec section 15).
  return pick(messages, ["map", "home", "alert", "sos", "places", "hotlines", "dam"]);
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
    // The photo-and-note form an admin confirms a rescue with is the teams' own (spec 5.4).
    authority: { finish: (all.authority as Messages).finish! },
    // The dam's state chip is the same component the public card wears, so it reads its own
    // words: four of them, not the whole namespace (12 Oct).
    dam: { state: (all.dam as Messages).state! },
    sos: { vulnerable: (all.sos as Messages).vulnerable! },
    report: { depths: (all.report as Messages).depths! },
  };
}

/**
 * The authority console: its own text, plus the words that must say the same thing as on the
 * sender's own form - the vulnerability flags, what is happening, and the depth labels.
 */
export function authorityMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  const sos = all.sos as Messages;
  return {
    ...pick(messages, ["authority"]),
    // The capability names are the war room's, so a team and an admin read the same words.
    warRoom: { capability: (all.warRoom as Messages).capability! },
    sos: { vulnerable: sos.vulnerable!, hazard: sos.hazard! },
    report: {
      depths: (all.report as Messages).depths!,
      trends: (all.report as Messages).trends!,
      roads: (all.report as Messages).roads!,
    },
  };
}

/** The impact dashboard (spec 16): its own text only. */
export function impactMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["impact"]);
}

/**
 * The layout, on every page: the language switcher's text, the few lines the weather chip in the
 * header needs, and the bell's list. The weather page's own text is not sent with it, so a page
 * that nobody opens the weather from stays as small as it was. Of the alert namespace only the
 * five level names travel: the bell shows a level badge, not a checklist.
 */
export function layoutMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  const weather = all.weather as { chip: AbstractIntlMessages; codes: AbstractIntlMessages };
  return {
    language: all.language!,
    // The Admin link is drawn in the browser, so the header's labels go with it: four words.
    nav: all.nav!,
    weather: { chip: weather.chip, codes: weather.codes },
    notices: all.notices!,
    alert: { level: (all.alert as Messages).level! },
  };
}
