/**
 * Jaga's five sounds (docs/brand.md "Sound", spec 4.8, decision of 9 Oct).
 *
 * They are generated here with the Web Audio API rather than loaded as files: nothing to
 * download on a bad connection, nothing to cache for offline, nothing to licence, and a few
 * hundred bytes of code instead of a few hundred kilobytes of audio.
 *
 * The rules the shapes below follow:
 *  - **Watch and Normal are silent.** A level that means "get ready" does not deserve a noise at
 *    three in the morning, and a sound people learn to ignore is worse than no sound.
 *  - **Only the offer alarm repeats** among the private sounds, and only while a team is being
 *    asked. Among the public ones only the dam release repeats, because that water is already on
 *    its way (spec 15).
 *  - **Sound is never alone.** Every entry carries a vibration pattern, and every caller also
 *    puts the same thing on the screen in words and an icon (the accessibility rule).
 *  - **Nothing plays until the person has tapped once.** Browsers refuse audio before a gesture,
 *    which is why `arm()` exists and why the authority console asks once.
 */

export type SoundName = "offer" | "accepted" | "rescued" | "alert" | "damRelease";

type Tone = {
  /** Hz. */
  freq: number;
  /** Milliseconds from the start of the sound. */
  at: number;
  /** Milliseconds. */
  ms: number;
  /** 0..1, before the shared output gain. */
  gain?: number;
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
 * the alarm (the shape of a European emergency siren, which people read as "answer me"), a rising
 * pair for good news, a falling resolve for "it is over", and low tones for an alert so it does
 * not sound like a notification from a game.
 */
export const SOUNDS: Record<SoundName, SoundSpec> = {
  // A team is being offered a case. The only insistent sound in Jaga.
  offer: {
    tones: [
      { freq: 784, at: 0, ms: 260 },
      { freq: 587, at: 300, ms: 260 },
      { freq: 784, at: 600, ms: 260 },
      { freq: 587, at: 900, ms: 260 },
    ],
    repeatEveryMs: 1500,
    vibrate: [220, 120, 220, 120, 220],
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
  // A new alert at Warning or Evacuate. One low double-tone, and nothing for Watch or Normal.
  alert: {
    tones: [
      { freq: 392, at: 0, ms: 300 },
      { freq: 392, at: 400, ms: 300 },
    ],
    repeatEveryMs: null,
    vibrate: [300, 150, 300],
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
  if (level === "warning" || level === "evacuate") return "alert";
  // normal, watch, return and anything unknown: silent on purpose.
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
    osc.type = "sine";
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
