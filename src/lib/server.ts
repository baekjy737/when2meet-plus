import { NextResponse } from "next/server";
import { safeEqualHex, sha256 } from "./crypto";
import { getStore } from "./store";
import type { EventRecord, PublicEvent, PublicParticipant } from "./types";

export const jsonError = (status: number, error: string) => NextResponse.json({ error }, { status });

export function toPublicEvent({ adminKeyHash: _, ...ev }: EventRecord): PublicEvent {
  return ev;
}

export async function loadEvent(id: string) {
  const store = await getStore();
  const ev = await store.getEvent(id);
  if (!ev) return null;
  const people: PublicParticipant[] = (await store.listParticipants(id)).map((p) => ({ id: p.id, name: p.name, slots: p.slots }));
  return { ev, people };
}

/** Admin key may come from `Authorization: Bearer <key>` or `?key=`. */
export function adminKeyFrom(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return new URL(req.url).searchParams.get("key");
}

export function isAdmin(ev: EventRecord, key: string | null | undefined): boolean {
  return !!key && safeEqualHex(sha256(key), ev.adminKeyHash);
}
