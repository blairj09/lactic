// next/headers for the desktop: no request, so no cookies, and the app's own host.

export async function headers() {
  return new Headers({ host: "lactic.local", "user-agent": navigator.userAgent });
}

export async function cookies() {
  return {
    get: (name: string) => (void name, undefined),
    getAll: () => [] as { name: string; value: string }[],
    set: (...args: unknown[]) => void args,
    delete: (name: string) => void name,
    has: (name: string) => (void name, false),
  };
}
