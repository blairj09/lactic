// Whether this build has plugins at all. When it does, Settings has a Plugins section.
import { isModular } from "~/app/beta";
import { isDesktop } from "~/platform/native";

/**
 * An iPhone, iPad or Android phone (an iPad can call itself a Mac, but has a touch screen). Read
 * from the browser so it's known before anything draws.
 */
export const onPhone =
  typeof navigator !== "undefined" && (/iPhone|iPad|iPod|Android/.test(navigator.userAgent) || (/^Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1));

/**
 * Lactic on a computer: Mac, Windows or Linux (James 2026-11-15). The phone apps don't have plugins
 * yet, except in Lactic Modular where they're being built. Development builds (the browser build
 * included, for testing) always do.
 */
export const pluginsAllowed = (isDesktop && (isModular || !onPhone)) || import.meta.env.DEV;
