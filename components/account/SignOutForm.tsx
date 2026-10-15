"use client";

import type { FormEvent, ReactNode } from "react";
import { SIGN_OUT_MESSAGE } from "@/lib/offline-warm";

/** How long the sign-out waits for the service worker before going ahead anyway. */
const WAIT_MS = 1500;

/** Ask the service worker to forget the cached copies that could hold this person's pages. */
export function forgetCachedPages(): Promise<void> {
  const worker = typeof navigator !== "undefined" ? navigator.serviceWorker?.controller : null;
  if (!worker) return Promise.resolve();
  return new Promise((done) => {
    const channel = new MessageChannel();
    const timer = setTimeout(done, WAIT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      done();
    };
    worker.postMessage({ type: SIGN_OUT_MESSAGE }, [channel.port2]);
  });
}

/**
 * The sign-out button's form. Before the browser posts it, the phone's cached copies of personal
 * pages are dropped, so on a shared phone the next person cannot open them offline (A10 security
 * review). Without a service worker it is a plain form.
 */
export function SignOutForm({ children }: { children: ReactNode }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    if (form.dataset.cleared === "1") return;
    event.preventDefault();
    await forgetCachedPages();
    form.dataset.cleared = "1";
    form.submit();
  }
  return (
    <form action="/api/auth/sign-out" method="post" onSubmit={submit} data-sign-out>
      {children}
    </form>
  );
}
