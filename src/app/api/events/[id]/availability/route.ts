import { NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { jsonError } from "@/lib/server";
import { allSlots } from "@/lib/slots";
import { getStore } from "@/lib/store";

const unauthorized = () => NextResponse.json({ code: "SESSION_INVALID", error: "응답이 삭제되었거나 수정 권한이 만료되었습니다. 다시 들어오세요." }, { status: 401 });
const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

/** Authenticated snapshot used when returning to a saved response or after a conflict. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const participantId = new URL(req.url).searchParams.get("participantId") ?? "";
  const token = bearer(req);
  const store = await getStore();
  if (!token || !await store.hasParticipantSession(id, participantId, sha256(token))) return unauthorized();
  const participant = await store.getParticipant(id, participantId);
  if (!participant) return unauthorized();
  return NextResponse.json({ name: participant.name, slots: participant.slots, revision: participant.revision }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.slots)) return jsonError(400, "slots required");
  const participantId = String(body.participantId ?? "");
  const token = typeof body.token === "string" ? body.token : bearer(req);
  const store = await getStore();
  const ev = await store.getEvent(id);
  if (!ev) return jsonError(404, "event not found");
  if (!token) return unauthorized();
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
    return NextResponse.json({ code: "REFRESH_REQUIRED", error: "저장 방식이 변경되었습니다. 새로고침 후 다시 선택해 주세요." }, { status: 428 });
  }
  const valid = new Set(allSlots(ev));
  const slots = [...new Set<string>(body.slots.filter((s: unknown): s is string => typeof s === "string"))]
    .filter((s) => valid.has(s)).sort();
  const result = await store.updateAvailability(id, participantId, sha256(token), body.revision, slots);
  if (result.status === "unauthorized") return unauthorized();
  const { participant } = result;
  if (result.status === "conflict") {
    return NextResponse.json({ code: "REVISION_CONFLICT", error: "다른 기기에서 응답이 변경되었습니다. 최신 응답을 불러온 뒤 다시 선택해 주세요.",
      slots: participant.slots, revision: participant.revision }, { status: 409 });
  }
  return NextResponse.json({ ok: true, slots: participant.slots, revision: participant.revision });
}
