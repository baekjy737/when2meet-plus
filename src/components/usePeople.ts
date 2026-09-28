"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicParticipant } from "@/lib/types";

/** Participants list, refreshed periodically so the group view stays live. */
export function usePeople(eventId: string, initial: PublicParticipant[], intervalMs = 10_000) {
  const [people, setPeople] = useState(initial);

  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const res = await fetch(`/api/events/${eventId}`, { cache: "no-store" }).catch(() => null);
      if (res?.ok) setPeople((await res.json()).participants);
    }, intervalMs);
    return () => clearInterval(t);
  }, [eventId, intervalMs]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people) for (const s of p.slots) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  }, [people]);

  return { people, setPeople, counts };
}
