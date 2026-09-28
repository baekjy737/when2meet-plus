import { NextResponse } from "next/server";
import { jsonError, loadEvent, toPublicEvent } from "@/lib/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const data = await loadEvent((await params).id);
  if (!data) return jsonError(404, "event not found");
  return NextResponse.json({ event: toPublicEvent(data.ev), participants: data.people });
}
