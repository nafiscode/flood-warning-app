"use client";

import { lineHrefFor, runsAsApp } from "@/lib/flow-cookie";

/**
 * The "sign in with LINE" link. It stays a plain link, so it works before any script has loaded
 * and a phone opens the LINE app for it. When it is tapped inside Jaga on the home screen it
 * says so in the address: the LINE app will come back in the phone's browser, and the sign-in
 * must then be finished here in the app instead (components/SignInFinisher.tsx).
 */
export function LineLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      rel="nofollow"
      className={className}
      data-line-link
      onClick={(event) => {
        event.currentTarget.href = lineHrefFor(href, runsAsApp(window));
      }}
    >
      {children}
    </a>
  );
}
