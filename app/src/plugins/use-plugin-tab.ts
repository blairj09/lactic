// Whether this build has plugins at all. When it does, Settings has a Plugins section.
import { isDesktop } from "~/platform/native";

/**
 * An iPhone, iPad or Android phone (an iPad can call itself a Mac, but has a touch screen). Read
 * from the browser so it's known before anything draws.
 */
export const onPhone =
  typeof navigator !== "undefined" && (/iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (/^Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1));

/**
 * Every Lactic app: Mac, Windows and Linux (James 2026-11-15) and the phones (James 2026-11-16). A phone
 * adds only Lactic's own plugins and runs the ones added on its computer once approved there (store.ts).
 * Development builds (the browser build included, for testing) always do.
 */
export const pluginsAllowed = isDesktop || import.meta.env.DEV;
