import Nav from "@/components/nav";
import { Page, PageHeader } from "@/components/ui";
import { loadLayout } from "@/lib/layout-data";
import { createClient } from "@/lib/supabase/server";
import { PluginsTab } from "~/plugins/plugins-tab";

export const metadata = { title: "Plugins · Lactic" };
export const dynamic = "force-dynamic";

/** Lactic Modular: cards from the rider's plugins, on screens they name. Never on Today. */
export default async function PluginsPage() {
  const layout = await loadLayout(await createClient());
  return (
    <>
      <Nav current="/plugins" />
      <Page>
        <PageHeader title="Plugins" />
        <PluginsTab initial={layout} />
      </Page>
    </>
  );
}
