import { NextResponse } from "next/server";
import { hashPassword, newId, newSecret, sha256, verifyPassword } from "@/lib/crypto";
import { jsonError } from "@/lib/server";
import { getStore } from "@/lib/store";

/** Sign in as a participant (creating them on first use), When2meet-style. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? "").trim().slice(0, 50);
  const password = String(body?.password ?? "");
  if (!name) return jsonError(400, "이름을 입력하세요");

  const store = await getStore();
  if (!(await store.getEvent(id))) return jsonError(404, "event not found");

  const token = newSecret();
  const existing = await store.getParticipantByName(id, name);
  if (existing) {
    if (existing.passwordHash && !verifyPassword(password, existing.passwordHash)) return jsonError(401, "비밀번호가 틀렸습니다");
    await store.upsertParticipant({ ...existing, sessionHash: sha256(token) });
    return NextResponse.json({ participantId: existing.id, token, slots: existing.slots });
  }

  const participant = {
    id: newId(), eventId: id, name, passwordHash: password ? hashPassword(password) : null,
    sessionHash: sha256(token), slots: [], updatedAt: new Date().toISOString(),
  };
  await store.upsertParticipant(participant);
  return NextResponse.json({ participantId: participant.id, token, slots: [] }, { status: 201 });
}
