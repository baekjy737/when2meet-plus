"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { PublicParticipant } from "@/lib/types";

/** Participants list, refreshed periodically so the group view stays live. */
export function usePeople(eventId: string, initial: PublicParticipant[], intervalMs = 10_000) {
  const [people, updatePeople] = useState(initial);
  const generation = useRef(0);
  const setPeople: Dispatch<SetStateAction<PublicParticipant[]>> = useCallback((next) => {
    generation.current++;
    updatePeople(next);
  }, []);

  useEffect(() => {
    let active = true;
    let polling = false;
    const t = setInterval(async () => {
      if (document.hidden || polling) return;
      polling = true;
      const current = generation.current;
      try {
        const res = await fetch(`/api/events/${eventId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        // A delayed poll must not resurrect a deleted person or overwrite a local save.
        if (active && current === generation.current && Array.isArray(data.participants)) updatePeople(data.participants);
      } catch { /* Keep the last known group response while offline. */ }
      finally { polling = false; }
    }, intervalMs);
    return () => { active = false; clearInterval(t); };
  }, [eventId, intervalMs]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of people) for (const s of p.slots) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  }, [people]);

  return { people, setPeople, counts };
}
