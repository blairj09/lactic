// next/navigation on react-router, for web app components reused in the desktop app.

import { useLocation, useNavigate, useParams as useRouterParams, useSearchParams as useRouterSearch } from "react-router";
import { revalidatePath } from "./next-cache";

let navigateRef: ((to: string, opts?: { replace?: boolean }) => void) | null = null;

/** Set by the app shell so redirect() and router calls outside components can navigate. */
export function setNavigator(fn: typeof navigateRef) {
  navigateRef = fn;
}

export function useRouter() {
  const navigate = useNavigate();
  return {
    push: (to: string) => navigate(to),
    replace: (to: string) => navigate(to, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => revalidatePath(),
    prefetch: () => undefined,
  };
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  return useRouterSearch()[0];
}

export function useParams<T extends Record<string, string>>() {
  return useRouterParams() as T;
}

export class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`Redirect to ${to}`);
  }
}

/** In a server action this ends the action; here it navigates and stops the caller the same way. */
export function redirect(to: string): never {
  navigateRef?.(to);
  throw new RedirectError(to);
}

export function permanentRedirect(to: string): never {
  return redirect(to);
}

export function notFound(): never {
  throw new RedirectError("/");
}
