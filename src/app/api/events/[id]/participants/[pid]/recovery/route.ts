import { NextResponse } from "next/server";
import { newSecret, sha256 } from "@/lib/crypto";
import { adminKeyFrom, isAdmin, jsonError } from "@/lib/server";
import { getStore } from "@/lib/store";

/** Organizer-assisted recovery revokes all existing sessions and edit links. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const store = await getStore();
  const event = await store.getEvent(id);
  if (!event) return jsonError(404, "event not found");
  if (!isAdmin(event, adminKeyFrom(req))) return jsonError(403, "관리자 권한이 필요합니다.");
  const editKey = newSecret();
  if (!await store.recoverParticipant(id, pid, sha256(editKey))) return jsonError(404, "응답을 찾을 수 없습니다.");
  return NextResponse.json({ editKey }, { headers: { "cache-control": "no-store" } });
}
