import { notFound } from "next/navigation";
import AdminView from "@/components/AdminView";
import { loadEvent, toPublicEvent } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await loadEvent((await params).id);
  if (!data) notFound();
  return <AdminView event={toPublicEvent(data.ev)} initialPeople={data.people} />;
}
