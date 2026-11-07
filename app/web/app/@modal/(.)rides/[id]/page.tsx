import RideDetail from "../../../rides/[id]/ride-detail";
import Sheet from "@/components/sheet";

export const dynamic = "force-dynamic";

/** A ride link followed inside the app opens the ride over the page it came from; reloading opens the full page. */
export default async function RideModalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Sheet>
      <RideDetail id={id} />
    </Sheet>
  );
}
