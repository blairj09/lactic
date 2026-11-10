import Link from "next/link";
import Nav from "@/components/nav";
import { Page } from "@/components/ui";
import RideDetail from "./ride-detail";
import { ExportRideButton } from "~/data/export-buttons";

export const metadata = { title: "Ride · My Coach" };
export const dynamic = "force-dynamic";

export default async function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Nav current="/history" />
      <Page>
        <RideDetail
          id={id}
          actions={
            <>
              <ExportRideButton id={id} />
              <Link href="/history" className="text-sm text-muted hover:text-ink">
                All rides
              </Link>
            </>
          }
        />
      </Page>
    </>
  );
}
