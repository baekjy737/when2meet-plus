import { notFound } from "next/navigation";
import type { Metadata } from "next";
import EventView from "@/components/EventView";
import { loadEvent, toPublicEvent } from "@/lib/server";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const event = await (await getStore()).getEvent((await params).id);
  return { title: event ? `${event.name} · When2meet+` : "일정을 찾을 수 없어요 · When2meet+" };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await loadEvent((await params).id);
  if (!data) notFound();
  return <EventView key={data.ev.id} event={toPublicEvent(data.ev)} initialPeople={data.people} />;
}
