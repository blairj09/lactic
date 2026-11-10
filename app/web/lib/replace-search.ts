// Puts a screen's view (a range, a filter) in the address without navigating, so the page doesn't
// reload its data but coming back to it finds the same view. In the desktop app the route lives in
// the hash (#/progress?from=…), so the query goes there. history.state is kept, since the router
// keeps its place in history there and Back needs it.

export const URL_REPLACED = "lactic:url-replaced";

export function replaceSearch(params: URLSearchParams) {
  const q = params.toString();
  const { hash } = window.location;
  const url = hash.startsWith("#/") ? `${hash.split("?")[0]}${q ? `?${q}` : ""}` : `${window.location.pathname}${q ? `?${q}` : ""}`;
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(URL_REPLACED));
}
