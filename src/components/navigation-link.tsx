"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { createPortal } from "react-dom";

function NavigationFeedback() {
  const { pending } = useLinkStatus();
  return pending
    ? createPortal(
        <span className="navigation-progress" role="status">
          <span className="sr-only">Se încarcă pagina…</span>
        </span>,
        document.body,
      )
    : null;
}

export function NavigationLink({
  children,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link {...props} prefetch={true}>
      {children}
      <NavigationFeedback />
    </Link>
  );
}
