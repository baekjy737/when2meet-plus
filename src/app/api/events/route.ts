import { NextResponse } from "next/server";
import { newId, newSecret, sha256 } from "@/lib/crypto";
import { jsonError } from "@/lib/server";
import { getStore } from "@/lib/store";
import { validateEventInput } from "@/lib/event-validation";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const validated = validateEventInput(body);
  if (!validated.ok) return jsonError(400, validated.error);

  const id = newId();
  const adminKey = newSecret();
  const store = await getStore();
  await store.createEvent({
    id, ...validated.value,
    adminKeyHash: sha256(adminKey), createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ id, adminKey }, { status: 201 });
}
