// Whether the main bar shows a Plugins tab: Lactic Modular (or a dev build) on a computer, once an
// added plugin has a card. It updates as plugins are added, switched or removed.
import { useEffect, useState } from "react";
import { isModular } from "~/app/beta";
import { isDesktop } from "~/platform/native";
import { listPlugins } from "./store";

/** Lactic Modular on a computer, or any development build (the browser build included, for testing). */
export const pluginsAllowed = (isModular && isDesktop) || import.meta.env.DEV;

export function usePluginTab(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!pluginsAllowed) return;
    let live = true;
    const check = () =>
      void listPlugins()
        .then((ps) => live && setShow(ps.some((p) => p.manifest.contributes.widgets.length > 0)))
        .catch(() => undefined);
    check();
    window.addEventListener("lactic:plugins", check);
    return () => {
      live = false;
      window.removeEventListener("lactic:plugins", check);
    };
  }, []);
  return show;
}
