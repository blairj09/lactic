// Lactic is in beta. This stays on until James says otherwise; never turn it off as part of a
// version bump. (The site's Beta tags, the README and the release names say the same.)
export const isBeta = true;

// A Lactic Preview build: a testing build of main or a pull request (CI sets VITE_LACTIC_CHANNEL,
// see tauri.preview.conf.json). It's its own app with its own data, and says Preview, not Beta.
export const isPreview = import.meta.env.VITE_LACTIC_CHANNEL === "preview";
