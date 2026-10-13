/**
 * Jaga's sounds (docs/brand.md "Sound", spec 4.8, decision of 9 Oct).
 *
 * They are generated here with the Web Audio API rather than loaded as files: nothing to
 * download on a bad connection, nothing to cache for offline, nothing to licence, and a few
 * hundred bytes of code instead of a few hundred kilobytes of audio.
 *
 * The rules the shapes below follow:
 *  - **Every alert rings in an open app, Watch and Safe to return more quietly** (the owner,
 *    13 Oct, superseding "Watch is silent"). Normal is the absence of an alert and has no sound.
 *  - **Only the offer alarm repeats** among the private sounds, and only while a team is being
 *    asked. Among the public ones only the dam release repeats, because that water is already on
 *    its way (spec 15).
 *  - **Sound is never alone.** Every entry carries a vibration pattern, and every caller also
 *    puts the same thing on the screen in words and an icon (the accessibility rule).
 *  - **Nothing plays until the person has tapped once.** Browsers refuse audio before a gesture,
 *    which is why `arm()` exists and why the authority console asks once.
 */

export type SoundName =
  | "offer"
  | "supplyOffer"
  | "accepted"
  | "rescued"
  | "alertWatch"
  | "alertWarning"
  | "alertEvacuate"
  | "alertReturn"
  | "damRelease"
  | "announcement"
  | "notice";

/** The shortest an alert sound may be (the owner, 13 Oct): long enough not to be missed. */
export const ALERT_MIN_MS = 5000;

type Tone = {
  /** Hz. */
  freq: number;
  /** Milliseconds from the start of the sound. */
  at: number;
  /** Milliseconds. */
  ms: number;
  /** 0..1, before the shared output gain. */
  gain?: number;
  /** The waveform. A sine is round and soft; a triangle is brighter and carries on a small speaker. */
  type?: "sine" | "triangle";
};

export type SoundSpec = {
  tones: Tone[];
  /** Milliseconds between repeats, or null for a sound that plays once. */
  repeatEveryMs: number | null;
  /** navigator.vibrate pattern, in milliseconds: buzz, pause, buzz… */
  vibrate: number[];
};

/**
 * A5 and A7 use these by name. The frequencies are deliberately plain: two alternating notes for
 * the alarm (the shape of an emergency two-tone, which people read as "answer me"), a rising
 * pair for good news, a falling resolve for "it is over", and low tones for an alert so it does
 * not sound like a notification from a game.
 */
export const SOUNDS: Record<SoundName, SoundSpec> = {
  // A team is being offered a case. The only insistent sound in Jaga. The owner's choice of 12
  // October from eighteen candidates played on the tracker ("fast two-tone"): six short notes,
  // high and low in turn, then a breath. Brighter and higher than the first version, so it
  // carries on a cheap phone speaker over rain and an engine.
  offer: {
    tones: [0, 1, 2, 3, 4, 5].map((i) => ({
      freq: i % 2 === 0 ? 988 : 740,
      at: i * 150,
      ms: 130,
      type: "triangle" as const,
    })),
    repeatEveryMs: 1300,
    vibrate: [120, 60, 120, 60, 120, 60, 120],
  },
  // A team is being offered a request for food and water (spec 4.10). Nobody is in danger, so it
  // is everything the alarm is not: low, round, three unhurried notes, played once. A crew with
  // both jobs must never take one for the other by ear.
  supplyOffer: {
    tones: [
      { freq: 523, at: 0, ms: 220, gain: 0.55 },
      { freq: 523, at: 300, ms: 220, gain: 0.55 },
      { freq: 659, at: 600, ms: 420, gain: 0.55 },
    ],
    repeatEveryMs: null,
    vibrate: [200, 150, 200],
  },
  // A team accepted: the requester's screen. Relief, not celebration.
  accepted: {
    tones: [
      { freq: 587, at: 0, ms: 140 },
      { freq: 880, at: 130, ms: 260 },
    ],
    repeatEveryMs: null,
    vibrate: [120, 80, 200],
  },
  // Rescued, or "I'm safe now". Three soft notes resolving downward.
  rescued: {
    tones: [
      { freq: 880, at: 0, ms: 180, gain: 0.5 },
      { freq: 698, at: 170, ms: 180, gain: 0.5 },
      { freq: 523, at: 340, ms: 420, gain: 0.5 },
    ],
    repeatEveryMs: null,
    vibrate: [90, 70, 90, 70, 160],
  },
  // An announcement from Jaga's admins (the owner, 13 Oct: positive, nothing like an alert or
  // an alarm). A bright rising four-note figure that lands on its top note and rings: news,
  // not danger. Higher and lighter than every alert sound.
  announcement: {
    tones: [
      { freq: 523, at: 0, ms: 160, gain: 0.5 },
      { freq: 659, at: 150, ms: 160, gain: 0.5 },
      { freq: 784, at: 300, ms: 160, gain: 0.5 },
      { freq: 1047, at: 450, ms: 520, gain: 0.5 },
    ],
    repeatEveryMs: null,
    vibrate: [80, 60, 80],
  },
  // Anything else new in the bell (an alert that has ended, news about one's own team): two
  // quiet notes, so every item is heard without any of them sounding urgent.
  notice: {
    tones: [
      { freq: 698, at: 0, ms: 140, gain: 0.4 },
      { freq: 880, at: 140, ms: 240, gain: 0.4 },
    ],
    repeatEveryMs: null,
    vibrate: [70],
  },
  /*
   * The four alert sounds (the owner, 13 Oct): one per level, so the level is heard before the
   * screen is read, and each at least five seconds long so it is not missed. They rise in
   * urgency the way the levels do, and none of them can be taken for the teams' offer alarm,
   * which is much faster.
   */
  // Watch: a soft two-note chime, three times. "Get ready", not "run".
  alertWatch: {
    tones: [0, 1, 2].flatMap((i) => [
      { freq: 523, at: i * 2000, ms: 420, gain: 0.5 },
      { freq: 659, at: i * 2000 + 450, ms: 700, gain: 0.5 },
    ]),
    repeatEveryMs: null,
    vibrate: [200, 1800, 200, 1800, 200],
  },
  // Warning: a low, firm double-tone, four times.
  alertWarning: {
    tones: [0, 1, 2, 3].flatMap((i) => [
      { freq: 392, at: i * 1400, ms: 380 },
      { freq: 392, at: i * 1400 + 480, ms: 380 },
    ]),
    repeatEveryMs: null,
    vibrate: [300, 150, 300, 650, 300, 150, 300, 650, 300, 150, 300, 650, 300, 150, 300],
  },
  // Evacuate: a high-low call, half a second a note, six times without a pause. The most
  // insistent of the four; brighter (triangle) so it carries on a small speaker.
  alertEvacuate: {
    tones: [0, 1, 2, 3, 4, 5].flatMap((i) => [
      { freq: 880, at: i * 1000, ms: 480, type: "triangle" as const },
      { freq: 660, at: i * 1000 + 500, ms: 480, type: "triangle" as const },
    ]),
    repeatEveryMs: null,
    vibrate: [450, 50, 450, 50, 450, 50, 450, 50, 450, 50, 450, 50, 450, 50, 450, 50, 450],
  },
  // Safe to return: three unhurried notes settling downward, twice. Relief.
  alertReturn: {
    tones: [0, 1].flatMap((i) => [
      { freq: 659, at: i * 2700, ms: 600, gain: 0.5 },
      { freq: 523, at: i * 2700 + 650, ms: 600, gain: 0.5 },
      { freq: 392, at: i * 2700 + 1300, ms: 1000, gain: 0.5 },
    ]),
    repeatEveryMs: null,
    vibrate: [150, 500, 150, 500, 300],
  },
  // A dam release notice (spec 15). Its own rising figure, repeated: the water is already coming.
  damRelease: {
    tones: [
      { freq: 440, at: 0, ms: 200 },
      { freq: 554, at: 200, ms: 200 },
      { freq: 659, at: 400, ms: 360 },
    ],
    repeatEveryMs: 2200,
    vibrate: [180, 90, 180, 90, 400],
  },
};

/** Alert levels that make a sound at all, and which one (docs/brand.md). */
export function soundForAlertLevel(level: string): SoundName | null {
  if (level === "watch") return "alertWatch";
  if (level === "warning") return "alertWarning";
  if (level === "evacuate") return "alertEvacuate";
  if (level === "return") return "alertReturn";
  // Normal is the absence of an alert, and anything unknown stays silent.
  return null;
}

type Ctor = typeof AudioContext;

function audioCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let ctx: AudioContext | null = null;

/**
 * Called from a tap: makes (or wakes) the audio context so later sounds can play without one.
 * Returns false where the browser has no Web Audio at all, so the caller can stay quiet about a
 * button that would do nothing.
 */
export async function arm(): Promise<boolean> {
  const Ctor = audioCtor();
  if (!Ctor) return false;
  try {
    ctx ??= new Ctor();
    // iPhone: the ring/silent switch mutes a page's sounds unless the page says it is playing
    // media. Saying so lets an alert be heard with the switch on silent. It cannot raise a
    // volume that is turned all the way down, and no web page can (docs/brand.md "Sound").
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    if (ctx.state === "suspended") await ctx.resume();
    return ctx.state === "running";
  } catch {
    return false;
  }
}

export function isArmed(): boolean {
  return ctx?.state === "running";
}

/** For tests and for a console that is closing. */
export function reset(): void {
  ctx?.close().catch(() => {});
  ctx = null;
}

function playOnce(spec: SoundSpec, volume: number): void {
  if (!ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (const tone of spec.tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;
    const start = now + tone.at / 1000;
    const end = start + tone.ms / 1000;
    const peak = volume * (tone.gain ?? 0.8);
    // A short ramp at each end: a square-edged tone clicks, and a click is what people hear.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.015);
    gain.gain.setValueAtTime(peak, Math.max(start + 0.015, end - 0.04));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

function buzz(pattern: number[]): void {
  if (typeof navigator === "undefined") return;
  const n = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  try {
    n.vibrate?.(pattern);
  } catch {
    // A browser that refuses to vibrate changes nothing: the words are on the screen.
  }
}

export type Playing = { stop: () => void };

/**
 * Play a sound. A repeating one keeps going until the returned handle is stopped - the caller
 * stops it when the offer is answered, passes on, or the screen closes.
 */
export function play(name: SoundName, options: { volume?: number } = {}): Playing {
  const spec = SOUNDS[name];
  const volume = options.volume ?? 0.6;
  playOnce(spec, volume);
  buzz(spec.vibrate);
  if (spec.repeatEveryMs === null) return { stop: () => {} };
  const timer = setInterval(() => {
    playOnce(spec, volume);
    buzz(spec.vibrate);
  }, spec.repeatEveryMs);
  return {
    stop: () => clearInterval(timer),
  };
}

/** How long one pass of a sound lasts, in milliseconds. Used by tests and by the console. */
export function durationMs(name: SoundName): number {
  return SOUNDS[name].tones.reduce((end, t) => Math.max(end, t.at + t.ms), 0);
}
