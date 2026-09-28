import { NextResponse } from "next/server";
import { newId, newSecret, sha256 } from "@/lib/crypto";
import { jsonError } from "@/lib/server";
import { getStore } from "@/lib/store";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return jsonError(400, "invalid JSON");

  const name = String(body.name ?? "").trim().slice(0, 100);
  const dates = [...new Set<string>(Array.isArray(body.dates) ? body.dates : [])].filter((d) => DATE_RE.test(d)).sort();
  const slotMinutes = Number(body.slotMinutes ?? 30);
  const startMin = Number(body.startMin);
  const endMin = Number(body.endMin);
  const timezone = String(body.timezone || "Asia/Seoul");

  if (!name) return jsonError(400, "이벤트 이름을 입력하세요");
  if (dates.length === 0 || dates.length > 62) return jsonError(400, "날짜를 1~62개 선택하세요");
  if (![15, 30, 60].includes(slotMinutes)) return jsonError(400, "slotMinutes must be 15, 30 or 60");
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || endMin - startMin < slotMinutes)
    return jsonError(400, "시간 범위가 올바르지 않습니다");
  if (startMin % slotMinutes || endMin % slotMinutes) return jsonError(400, "시간 범위는 슬롯 단위에 맞아야 합니다");

  const id = newId();
  const adminKey = newSecret();
  const store = await getStore();
  await store.createEvent({
    id, name, dates, startMin, endMin, slotMinutes, timezone,
    adminKeyHash: sha256(adminKey), createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id, adminKey }, { status: 201 });
}
