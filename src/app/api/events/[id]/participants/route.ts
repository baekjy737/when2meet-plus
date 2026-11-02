import { NextResponse } from "next/server";
import { hashPassword, newId, newSecret, sha256, verifyPassword } from "@/lib/crypto";
import { jsonError } from "@/lib/server";
import { getStore, type ParticipantProof } from "@/lib/store";
import type { Participant } from "@/lib/types";

const protectedResponse = () => NextResponse.json({
  code: "RESPONSE_PROTECTED",
  error: "이미 응답한 이름입니다. 기존 기기, 비밀번호 또는 개인 수정 링크로 들어오세요.",
}, { status: 409 });
const invalidSession = () => NextResponse.json({ code: "SESSION_INVALID", error: "수정 권한을 확인할 수 없습니다. 비밀번호나 개인 수정 링크로 다시 들어오세요." }, { status: 401 });
const response = (p: Participant, token: string, status = 200) => NextResponse.json({
  participantId: p.id, name: p.name, token, slots: p.slots, revision: p.revision,
}, { status, headers: { "cache-control": "no-store" } });

/** First participation needs only a name. Re-entry requires proof of ownership. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError(400, "요청 형식이 올바르지 않습니다.");
  const name = String(body.name ?? "").trim().slice(0, 50);
  const participantId = String(body.participantId ?? "");
  const password = String(body.password ?? "");
  if (!name && !participantId) return jsonError(400, "이름을 입력하세요");
  if (password.length > 1024) return jsonError(400, "비밀번호가 너무 깁니다.");
  const store = await getStore();
  if (!(await store.getEvent(id))) return jsonError(404, "event not found");
  const existing = participantId
    ? await store.getParticipant(id, participantId)
    : await store.getParticipantByName(id, name);
  const token = newSecret();

  if (existing) {
    const proof: ParticipantProof = {};
    if (typeof body.token === "string" && body.token) proof.sessionHash = sha256(body.token);
    if (typeof body.editKey === "string" && body.editKey) proof.editKeyHash = sha256(body.editKey);
    if (existing.passwordHash && password && verifyPassword(password, existing.passwordHash)) proof.passwordHash = existing.passwordHash;
    if (await store.grantParticipantSession(id, existing.id, sha256(token), proof)) {
      // Use the current response/revision after authentication, not the earlier read.
      const current = await store.getParticipant(id, existing.id);
      return current ? response(current, token) : invalidSession();
    }
    if (body.token || body.editKey) return invalidSession();
    if (existing.passwordHash) return NextResponse.json({ code: "PASSWORD_INVALID", error: "비밀번호가 틀렸습니다" }, { status: 401 });
    return protectedResponse();
  }
  if (participantId || body.token || body.editKey) return invalidSession();
  const participant: Participant = {
    id: newId(), eventId: id, name, passwordHash: password ? hashPassword(password) : null,
    sessionHash: sha256(token), slots: [], revision: 0, editKeyHash: null, updatedAt: new Date().toISOString(),
  };
  // A second simultaneous name registration must not replace the first response.
  if (!(await store.createParticipant(participant))) return protectedResponse();
  return response(participant, token, 201);
}
