// next/cache for the desktop: there's no server cache, so a "revalidate" asks the open screens to
// load their data again.

export const DATA_CHANGED = "lactic:data-changed";

export function revalidatePath(path?: string, type?: "page" | "layout") {
  void type;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DATA_CHANGED, { detail: path }));
}

export function revalidateTag(tag?: string) {
  revalidatePath(tag);
}

export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
