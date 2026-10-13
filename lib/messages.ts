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
    ...pick(messages, ["home", "alert", "sos", "places", "hotlines", "install", "push", "journey"]),
    // The area chooser's province list.
    map: { province: all.map!.province! },
    // Residents' flood reports near the person (13 Oct), with the report form's own words for
    // depth, trend and road so they read the same on every screen.
    reportsNear: all.reportsNear!,
    report: {
      depths: (all.report as Messages).depths!,
      trends: (all.report as Messages).trends!,
      roads: (all.report as Messages).roads!,
    },
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
      // The drawing of the dam's state and the words under it (the owner's choice of 12 Oct).
      state: dam.state!,
      figure: dam.figure!,
      // When the water reaches their own tambon (S7, 13 Oct).
      arrival: dam.arrival!,
      // The card's button into the dam's whole report wears the same words as the map's legend.
      legend: dam.legend!,
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
    ...pick(messages, ["sos", "report", "hotlines", "home", "push", "journey"]),
    map: { province: all.map!.province! },
  };
}

/** The "put Jaga on your home screen" card, where it stands by itself (the Account page). */
export function installMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["install", "push"]);
}

export function reportMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["report", "sos", "hotlines", "reportsNear"]);
}

export function mapMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  // "dam" comes with the map because the dam is drawn in every view (spec section 15).
  const all = messages as Messages;
  return {
    ...pick(messages, ["map", "home", "alert", "sos", "places", "hotlines", "dam"]),
    // Residents' flood reports near the person (13 Oct), with the report form's own words for
    // depth, trend and road so they read the same on every screen.
    reportsNear: all.reportsNear!,
    report: {
      depths: (all.report as Messages).depths!,
      trends: (all.report as Messages).trends!,
      roads: (all.report as Messages).roads!,
    },
  };
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
    // What a request for food and water asks for reads the same as on the sender's form.
    sos: { vulnerable: (all.sos as Messages).vulnerable!, needs: (all.sos as Messages).needs! },
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
    ...pick(messages, ["authority", "push"]),
    // The capability names are the war room's, so a team and an admin read the same words.
    warRoom: { capability: (all.warRoom as Messages).capability! },
    sos: { vulnerable: sos.vulnerable!, hazard: sos.hazard!, needs: sos.needs! },
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

/**
 * The dam release screen (spec section 15): the form's own words, the reviewed template the
 * preview is built from, and the five level names. The template travels because the sender must
 * read exactly what will be sent before they send it - it is the one screen where the words
 * matter more than the screen does.
 */
export function damReleaseMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  const admin = all.admin as Messages;
  const dam = all.dam as Messages;
  return {
    admin: { damRelease: admin.damRelease! },
    dam: { release: dam.release! },
    alert: { level: (all.alert as Messages).level! },
  };
}
