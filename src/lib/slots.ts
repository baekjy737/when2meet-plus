import type { PublicEvent } from "./types";

export const pad = (n: number) => String(n).padStart(2, "0");
export const minToHHMM = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const slotId = (date: string, min: number) => `${date}T${minToHHMM(min)}`;

/** Minute offsets of each slot row within a day. */
export function slotMinutes(ev: Pick<PublicEvent, "startMin" | "endMin" | "slotMinutes">): number[] {
  const out: number[] = [];
  for (let m = ev.startMin; m + ev.slotMinutes <= ev.endMin; m += ev.slotMinutes) out.push(m);
  return out;
}

/** All slot ids of an event in chronological order. */
export function allSlots(ev: PublicEvent): string[] {
  const mins = slotMinutes(ev);
  return ev.dates.flatMap((d) => mins.map((m) => slotId(d, m)));
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
export function dateLabel(date: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${mo}/${d} (${WEEKDAYS[wd]})`;
}

export function parseSlot(id: string): { date: string; min: number } {
  const [date, hm] = id.split("T");
  const [h, m] = hm.split(":").map(Number);
  return { date, min: h * 60 + m };
}
