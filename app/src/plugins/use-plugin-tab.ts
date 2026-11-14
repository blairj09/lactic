// Whether this build has plugins at all: Lactic Modular on a computer, or any development build (the
// browser build included, for testing). When it does, the main bar always shows the Plugins tab.
import { isModular } from "~/app/beta";
import { isDesktop } from "~/platform/native";

/** Lactic Modular on a computer, or any development build (the browser build included, for testing). */
export const pluginsAllowed = (isModular && isDesktop) || import.meta.env.DEV;
