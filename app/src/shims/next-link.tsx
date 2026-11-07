// next/link on react-router, for web app components reused in the desktop app.

import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | { pathname?: string; query?: Record<string, string> }; prefetch?: boolean; scroll?: boolean; replace?: boolean };

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch, scroll, replace, ...rest }, ref) {
  void prefetch;
  void scroll;
  const to = typeof href === "string" ? href : `${href.pathname ?? ""}${href.query ? `?${new URLSearchParams(href.query)}` : ""}`;
  if (/^https?:/.test(to)) return <a ref={ref} href={to} target="_blank" rel="noreferrer" {...rest} />;
  return <RouterLink ref={ref} to={to} replace={replace} {...rest} />;
});

export default Link;
