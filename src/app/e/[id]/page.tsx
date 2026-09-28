import { notFound } from "next/navigation";
import EventView from "@/components/EventView";
import { loadEvent, toPublicEvent } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await loadEvent((await params).id);
  if (!data) notFound();
  return <EventView event={toPublicEvent(data.ev)} initialPeople={data.people} />;
}
