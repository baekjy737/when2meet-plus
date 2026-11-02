import { NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { adminKeyFrom, isAdmin, jsonError } from "@/lib/server";
import { getStore } from "@/lib/store";

/** An organizer can remove any response; a participant can withdraw their own. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const store = await getStore();
  const event = await store.getEvent(id);
  if (!event) return jsonError(404, "event not found");
  const credential = adminKeyFrom(req);
  if (!credential) return jsonError(401, "수정 권한이 필요합니다.");
  const admin = isAdmin(event, credential);
  const removed = await store.deleteParticipant(id, pid, admin ? undefined : sha256(credential));
  if (!removed) return admin ? jsonError(404, "응답을 찾을 수 없습니다.")
    : NextResponse.json({ code: "SESSION_INVALID", error: "이 응답을 삭제할 권한이 없습니다." }, { status: 401 });
  return NextResponse.json({ ok: true });
}
