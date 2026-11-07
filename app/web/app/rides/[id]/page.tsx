import Link from "next/link";
import Nav from "@/components/nav";
import { Page } from "@/components/ui";
import RideDetail from "./ride-detail";

export const metadata = { title: "Ride · My Coach" };
export const dynamic = "force-dynamic";

export default async function RidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Nav current="/progress" />
      <Page>
        <RideDetail
          id={id}
          actions={
            <Link href="/progress" className="text-sm text-muted hover:text-ink">
              All rides
            </Link>
          }
        />
      </Page>
    </>
  );
}
