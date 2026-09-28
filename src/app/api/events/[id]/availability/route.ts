import { NextResponse } from "next/server";
import { safeEqualHex, sha256 } from "@/lib/crypto";
import { jsonError } from "@/lib/server";
import { allSlots } from "@/lib/slots";
import { getStore } from "@/lib/store";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.slots)) return jsonError(400, "slots required");

  const store = await getStore();
  const ev = await store.getEvent(id);
  if (!ev) return jsonError(404, "event not found");
  const p = (await store.listParticipants(id)).find((x) => x.id === body.participantId);
  if (!p || !safeEqualHex(sha256(String(body.token ?? "")), p.sessionHash)) return jsonError(401, "다시 로그인하세요");

  const valid = new Set(allSlots(ev));
  const slots = [...new Set<string>(body.slots)].filter((s) => valid.has(s)).sort();
  await store.upsertParticipant({ ...p, slots, updatedAt: new Date().toISOString() });
  return NextResponse.json({ ok: true, slots });
}
