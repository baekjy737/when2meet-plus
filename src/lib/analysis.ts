import { allSlots, minToHHMM, parseSlot } from "./slots";
import type { PublicEvent, PublicParticipant } from "./types";

export type SlotStat = {
  slot: string;
  date: string;
  start: string;
  end: string;
  available: string[];
  unavailable: string[];
};

export type Block = {
  date: string;
  start: string;
  end: string;
  minutes: number;
  /** Participants available for the entire block. */
  available: string[];
  unavailable: string[];
};

export function slotStats(ev: PublicEvent, people: PublicParticipant[]): SlotStat[] {
  const sets = people.map((p) => ({ name: p.name, set: new Set(p.slots) }));
  return allSlots(ev).map((slot) => {
    const { date, min } = parseSlot(slot);
    const available: string[] = [];
    const unavailable: string[] = [];
    for (const p of sets) (p.set.has(slot) ? available : unavailable).push(p.name);
    return { slot, date, start: minToHHMM(min), end: minToHHMM(min + ev.slotMinutes), available, unavailable };
  });
}

/**
 * Ranks candidate meeting blocks of exactly `durationMin` minutes.
 * A block's attendees are those free for every slot in it.
 * Sorted by attendee count desc, then earliest start.
 */
export function bestBlocks(
  ev: PublicEvent,
  people: PublicParticipant[],
  opts: { durationMin?: number; minPeople?: number; limit?: number; required?: string[] } = {},
): Block[] {
  const duration = Math.max(ev.slotMinutes, opts.durationMin ?? ev.slotMinutes);
  const span = Math.ceil(duration / ev.slotMinutes);
  const minPeople = opts.minPeople ?? 1;
  const required = new Set(opts.required ?? []);
  const stats = slotStats(ev, people);

  const blocks: Block[] = [];
  for (let i = 0; i + span <= stats.length; i++) {
    const run = stats.slice(i, i + span);
    if (run.some((s) => s.date !== run[0].date)) continue;
    let common = new Set(run[0].available);
    for (const s of run.slice(1)) common = new Set(s.available.filter((n) => common.has(n)));
    if (common.size < minPeople) continue;
    if ([...required].some((n) => !common.has(n))) continue;
    const available = people.map((p) => p.name).filter((n) => common.has(n));
    blocks.push({
      date: run[0].date,
      start: run[0].start,
      end: run[run.length - 1].end,
      minutes: span * ev.slotMinutes,
      available,
      unavailable: people.map((p) => p.name).filter((n) => !common.has(n)),
    });
  }
  blocks.sort((a, b) => b.available.length - a.available.length || (a.date + a.start).localeCompare(b.date + b.start));
  return opts.limit ? blocks.slice(0, opts.limit) : blocks;
}
