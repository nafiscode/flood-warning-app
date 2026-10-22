/**
 * Which home screen a laptop shows (the owner, 23 Oct 2026: "options A + C"). A first visitor on
 * a laptop saw about seven things asking for a tap and no first move, so the page now shows one
 * thing at a time:
 *
 *   * **first**  - no area yet: one question, the area, with SOS beside it.
 *   * **area**   - an area, and the setup (sign in, then install) is not finished: the status
 *                  first, then one setup card that asks for one thing.
 *   * **member** - signed in and nothing left to set up: the page as it was, without nudges.
 *   * **tense**  - a place of theirs is at Warning or Evacuate: the page as it was. The alert and
 *                  what to do come first and nothing invites anybody to anything.
 *
 * Only a laptop (the console) is asked; a phone and a tablet held upright keep the layouts the
 * owner approved on 20 and 21 Oct. Kept pure so a test can fix every input without a browser.
 */
export type HomeStage = "first" | "area" | "member" | "tense";

export function homeStage(input: {
  /** An area chosen on this device, or a home saved in the account. */
  hasHome: boolean;
  signedIn: boolean;
  /** Jaga could still be installed here: not installed, not done, not inside a "Not now". */
  installPending: boolean;
  /** One of their places is at Warning or Evacuate. */
  tense: boolean;
}): HomeStage {
  if (input.tense) return "tense";
  if (!input.hasHome) return "first";
  if (!input.signedIn || input.installPending) return "area";
  return "member";
}

export type SetupKey = "area" | "signIn" | "install";
/** `wait`: not yet its turn (install, until the person has signed in). */
export type SetupState = "done" | "open" | "wait";
export type SetupStep = { key: SetupKey; state: SetupState };

/**
 * The three steps of the setup card, in order. Only the first one not done is open, so the card
 * only ever asks for one thing; install waits behind sign-in (the owner's answer, 23 Oct).
 */
export function setupSteps(input: {
  hasHome: boolean;
  signedIn: boolean;
  installPending: boolean;
}): SetupStep[] {
  const done: Record<SetupKey, boolean> = {
    area: input.hasHome,
    signIn: input.signedIn,
    install: !input.installPending,
  };
  const order: SetupKey[] = ["area", "signIn", "install"];
  const next = order.find((key) => !done[key]);
  return order.map((key) => ({
    key,
    state: done[key] ? "done" : key === next ? "open" : "wait",
  }));
}
