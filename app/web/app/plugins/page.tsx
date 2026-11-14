import Nav from "@/components/nav";
import { Page } from "@/components/ui";
import { loadLayout } from "@/lib/layout-data";
import { createClient } from "@/lib/supabase/server";
import { PluginsTab } from "~/plugins/plugins-home";

export const metadata = { title: "Plugins · Lactic" };
export const dynamic = "force-dynamic";

/** Lactic Modular: the one place for plugins. Cards on screens the rider names (never on Today), the
 * plugins they've added, and Lactic's own to browse. */
export default async function PluginsPage() {
  const layout = await loadLayout(await createClient());
  return (
    <>
      <Nav current="/plugins" />
      <Page>
        <PluginsTab initial={layout} />
      </Page>
    </>
  );
}
