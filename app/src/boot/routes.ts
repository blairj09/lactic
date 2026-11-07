// The web app's API routes, served in-process by fetch.ts.

import { addRoute } from "~/platform/fetch";

export function registerRoutes() {
  addRoute(/^\/api\/coach\/brief$/, () => import("@/app/api/coach/brief/route"));
  addRoute(/^\/api\/coach$/, () => import("@/app/api/coach/route"));
}
