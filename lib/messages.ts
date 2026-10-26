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
    ...pick(messages, [
      "home",
      "alert",
      "sos",
      "places",
      "hotlines",
      "install",
      "push",
      "journey",
      // The way into the Flood Risk Map, the tambon's own risk, and what an account gives (15 Oct).
      "mapFeatures",
      "tambonRisk",
      "signInOffer",
      // The way in for a rescue unit, beside the resident's own, under the hero (18 Oct).
      "unitWay",
      // A laptop's first screen and its setup card (23 Oct).
      "homeFlow",
      // The area chooser's box for coordinates and tambon names (23 Oct).
      "locationFinder",
      // Saying what a safe place is like now, from its card (20 Oct), and the line of what
      // residents have said. It carries its own copy of the three words about the road rather
      // than pulling the whole "report" namespace onto the home screen.
      "placeChecks",
      // "What the monitoring shows now" under the hero (17 Oct), and the credit it carries for
      // the one line of it that comes from a weather model.
      "monitoring",
      "attribution",
    ]),
    // The weather widget's words for what is falling, so the monitoring section says it the same
    // way the header's chip does. Four lines, not the whole weather page.
    weather: { codes: (all.weather as Messages).codes! },
    // The area chooser's province list.
    map: { province: all.map!.province! },
    // "New to Jaga?": the way into What Jaga can do for a first-time visitor (A17, 16 Oct).
    capabilities: {
      link: (all.capabilities as Messages).link!,
      welcome: (all.capabilities as Messages).welcome!,
    },
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
      // The notice says whose figures these are, in full (the owner, 14 Oct).
      operators: dam.operators!,
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
    // "locationFinder": the box over the pin map for coordinates and tambon names (23 Oct).
    ...pick(messages, ["sos", "report", "hotlines", "home", "push", "journey", "locationFinder"]),
    map: { province: all.map!.province! },
  };
}

/** The "put Jaga on your home screen" card, where it stands by itself (the Account page). */
export function installMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["install", "push"]);
}

export function reportMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["report", "sos", "hotlines", "reportsNear", "locationFinder"]);
}

export function mapMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  // "dam" comes with the map because the dam is drawn in every view (spec section 15).
  const all = messages as Messages;
  return {
    ...pick(messages, [
      "map",
      "home",
      "alert",
      "sos",
      "places",
      "hotlines",
      "dam",
      // The chips above the map and how the map was made (15 Oct); the hint on My places.
      "mapFeatures",
      "mapMethod",
      "signInOffer",
      // The one line that tells a team reading the map it can register (18 Oct).
      "unitWay",
      // Saying what a safe place is like now, from its own pin (20 Oct).
      "placeChecks",
      // The Sea and coast section (15 Oct), with the credit Open-Meteo asks for.
      "sea",
      "attribution",
      // The rain over the person's own places, opened from a cloud (15 Oct).
      "mapRain",
      // "What the monitoring shows now", inside the summary above the map (17 Oct).
      "monitoring",
      // The three ways in, in the rail: sign in, put Jaga on this device, register a team
      // (the owner, 23 Oct). "install" carries the steps for every kind of device.
      "install",
    ]),
    // The weather widget's words for what is falling, so the map says it the same way.
    weather: { codes: (all.weather as Messages).codes! },
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

/** The owner's team page and the join page (24 Oct 2026): their own words, and nothing else. */
export function unitTeamMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["unitTeam"]);
}

/**
 * A crew member's page (24 Oct 2026): its own words, plus the sender's vulnerability flags and
 * needs, the depth labels and the photo form a rescue is reported with, so a crew reads the same
 * words as the board.
 */
export function fieldCrewMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  const authority = all.authority as Messages;
  const sos = all.sos as Messages;
  return {
    ...pick(messages, ["fieldCrew", "push"]),
    authority: { finish: authority.finish!, supplies: authority.supplies! },
    sos: { vulnerable: sos.vulnerable!, needs: sos.needs! },
    report: { depths: (all.report as Messages).depths! },
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
    // The war room's basemap buttons say what the main map's say.
    map: { basemap: (all.map as Messages).basemap! },
    // The weather in words on its header (the same line the map console writes). Without these
    // the line printed its own key, "weather.codes.drizzle", to the people it was meant for.
    weather: {
      codes: (all.weather as Messages).codes!,
      chip: (all.weather as Messages).chip!,
      modelTime: (all.weather as Messages).modelTime!,
    },
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

/** The usage dashboard (14 Oct): its own words, and the alert level names it marks alerts with. */
export function usageMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return { ...pick(messages, ["usage"]), alert: { level: (all.alert as Messages).level! } };
}

/**
 * The layout, on every page: the language switcher's text, the few lines the weather chip in the
 * header needs, and the bell's list. The weather page's own text is not sent with it, so a page
 * that nobody opens the weather from stays as small as it was. Of the alert namespace two groups
 * travel: the five level names for the badge, and the drill mark the bell draws beside it.
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
    // The Share Jaga button a "share_app" announcement shows in the bell (25 Oct): its words,
    // the one group of "install", or next-intl prints "install.share.button" there (owner saw it).
    install: { share: (all.install as Messages).share! },
    // The level names for the badge, and the drill mark's three lines: the bell is where a sent
    // drill is read, and without them next-intl prints the key path (the owner saw it, 21 Oct).
    alert: { level: (all.alert as Messages).level!, drill: (all.alert as Messages).drill! },
    // The guide tour: the words of every page's steps (24 Oct 2026).
    guide: all.guide!,
    // The laptop header's "For rescue teams" (23 Oct): one phrase of the home flow's words.
    homeFlow: { navTeams: (all.homeFlow as Messages).navTeams! },
    // The "What Jaga can do" line at the end of each page (A17): one word.
    capabilities: { link: (all.capabilities as Messages).link! },
    // And "How Jaga works" beside it (A18), and "Who built Jaga" after that: two more words.
    howItWorks: {
      link: (all.howItWorks as Messages).link!,
      nav: { about: ((all.howItWorks as Messages).nav as Messages).about! },
    },
    // And the record of help (24 Oct): the page's own words travel with the page, this is its link.
    impactPublic: { link: (all.impactPublic as Messages).link! },
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
    dam: { release: dam.release!, operators: dam.operators! },
    alert: { level: (all.alert as Messages).level! },
    // The "What Jaga can do" line at the end of each page (A17): one word.
    capabilities: { link: (all.capabilities as Messages).link! },
  };
}
