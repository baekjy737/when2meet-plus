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
    const { date, min } = ev.mode === "date" ? { date: slot, min: 0 } : parseSlot(slot);
    const available: string[] = [];
    const unavailable: string[] = [];
    for (const p of sets) (p.set.has(slot) ? available : unavailable).push(p.name);
    return {
      slot, date, start: ev.mode === "date" ? "" : minToHHMM(min),
      end: ev.mode === "date" ? "" : minToHHMM(min + ev.slotMinutes), available, unavailable,
    };
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
  const span = ev.mode === "date" ? 1 : Math.ceil(duration / ev.slotMinutes);
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
      minutes: ev.mode === "date" ? 0 : span * ev.slotMinutes,
      available,
      unavailable: people.map((p) => p.name).filter((n) => !common.has(n)),
    });
  }
  blocks.sort((a, b) => b.available.length - a.available.length || (a.date + a.start).localeCompare(b.date + b.start));
  return opts.limit ? blocks.slice(0, opts.limit) : blocks;
}

/** Collapse overlapping or touching candidates with the same attendees, without crossing days. */
export function mergeContinuousBlocks(blocks: Block[]): Block[] {
  const groups = new Map<string, Block[]>();
  const result: Block[] = [];
  for (const block of blocks) {
    const copy = { ...block, available: [...block.available], unavailable: [...block.unavailable] };
    if (!block.start || !block.end) { result.push(copy); continue; }
    const key = JSON.stringify([block.date, [...block.available].sort()]);
    const group = groups.get(key) ?? [];
    group.push(copy);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start));
    let current: Block | undefined;
    for (const block of group) {
      if (current && block.start <= current.end) {
        current.end = current.end > block.end ? current.end : block.end;
        current.minutes = parseSlot(`${current.date}T${current.end}`).min - parseSlot(`${current.date}T${current.start}`).min;
      } else {
        current = block;
        result.push(current);
      }
    }
  }
  return result.sort((a, b) => b.available.length - a.available.length || (a.date + a.start).localeCompare(b.date + b.start));
}
