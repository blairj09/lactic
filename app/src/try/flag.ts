// The website's try-a-ride page (lactic.fit/ride/): a visitor connects their own trainer in Chrome or
// Edge and rides a short workout on Lactic's ride screen, with nothing saved or sent anywhere.
// Built with `npm run build:ride` (Vite's ride mode).

export const isTryRide = import.meta.env.MODE === "ride";
