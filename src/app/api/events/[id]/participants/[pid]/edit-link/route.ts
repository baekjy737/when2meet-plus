import { NextResponse } from "next/server";
import { newSecret, sha256 } from "@/lib/crypto";
import { adminKeyFrom } from "@/lib/server";
import { getStore } from "@/lib/store";

/** Rotate a private editing link without ending any authorized device session. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const token = adminKeyFrom(req);
  const editKey = newSecret();
  const store = await getStore();
  if (!token || !await store.setParticipantEditKey(id, pid, sha256(token), sha256(editKey))) {
    return NextResponse.json({ code: "SESSION_INVALID", error: "개인 수정 링크를 만들 권한이 없습니다." }, { status: 401 });
  }
  return NextResponse.json({ editKey }, { headers: { "cache-control": "no-store" } });
}
