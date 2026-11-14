// Whether this build has plugins at all: Lactic Modular (on a computer or an iPhone), or any
// development build (the browser build included, for testing). When it does, the main bar and the
// phone's tab bar always show the Plugins tab.
import { isModular } from "~/app/beta";

/** Lactic Modular, on a computer or an iPhone, or any development build. */
export const pluginsAllowed = isModular || import.meta.env.DEV;
