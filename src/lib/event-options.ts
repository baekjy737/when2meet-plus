import type { PublicEvent } from "./types";

/** One common initial meeting length for the screen and unfiltered exports. */
export function defaultMeetingDuration(event: Pick<PublicEvent, "mode" | "startMin" | "endMin" | "slotMinutes">): number {
  if (event.mode === "date") return event.slotMinutes;
  return Math.min(event.endMin - event.startMin, Math.max(event.slotMinutes, 60));
}
