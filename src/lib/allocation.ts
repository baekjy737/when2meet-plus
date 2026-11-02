import { minToHHMM, slotId } from "./slots";
import type { PublicEvent, PublicParticipant } from "./types";

export type AssignmentPerson = { id: string; name: string };
export type AllocationBlock = {
  id: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  eligible: AssignmentPerson[];
  assigned: AssignmentPerson[];
  missing: number;
};
export type PersonAllocation = AssignmentPerson & { count: number; minutes: number; eligibleBlocks: number };
export type AllocationResult = {
  blocks: AllocationBlock[];
  people: PersonAllocation[];
  remainders: { date: string; start: string; end: string; minutes: number }[];
  /** A work budget stopped further balancing; every returned assignment is still valid. */
  balanceLimited: boolean;
};

type Member = AssignmentPerson & { slots: Set<string>; eligibleBlocks: number; assignedRows: Set<number> };
type Row = { date: string; start: number; eligible: number[]; assigned: Set<number> };

const compareId = (a: AssignmentPerson, b: AssignmentPerson) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const MAX_BALANCE_STEPS = 1_000_000;
const MAX_IMPROVEMENTS = 1_000;

/**
 * Suggest staffing for fixed, nonoverlapping blocks anchored at each day's start.
 * Repeated participation is allowed. First handle scarce blocks, then redistribute
 * assignments along alternating paths to reduce differences in assignment counts.
 * Balancing has a fixed work budget: this is a proposal, not a global-optimum claim.
 */
export function allocateTime(
  ev: PublicEvent,
  people: PublicParticipant[],
  opts: { durationMin: number; minPeople: number },
): AllocationResult {
  if (ev.mode !== "time") throw new Error("시간 조율 이벤트에서만 TF 시간을 배분할 수 있습니다.");
  if (!Number.isSafeInteger(ev.slotMinutes) || ev.slotMinutes <= 0 ||
      !Number.isSafeInteger(ev.startMin) || !Number.isSafeInteger(ev.endMin) ||
      ev.startMin < 0 || ev.endMin > 1440 || ev.endMin <= ev.startMin) {
    throw new Error("이벤트의 시간 범위가 올바르지 않습니다.");
  }
  const { durationMin, minPeople } = opts;
  if (!Number.isSafeInteger(durationMin) || durationMin <= 0 || durationMin % ev.slotMinutes !== 0 ||
      durationMin > ev.endMin - ev.startMin) {
    throw new Error(`배정 시간은 ${ev.slotMinutes}분 단위이며 이벤트의 하루 시간 범위 이내여야 합니다.`);
  }
  if (!Number.isSafeInteger(minPeople) || minPeople <= 0) {
    throw new Error("최소 인원은 1 이상의 정수로 입력하세요.");
  }
  if (new Set(people.map((person) => person.id)).size !== people.length) {
    throw new Error("참가자 정보가 중복되어 있습니다. 새로고침 후 다시 계산하세요.");
  }

  const members: Member[] = people.map((person) => ({
    id: person.id, name: person.name, slots: new Set(person.slots), eligibleBlocks: 0, assignedRows: new Set<number>(),
  })).sort(compareId);
  const rows: Row[] = [];
  const remainders: AllocationResult["remainders"] = [];
  for (const date of [...new Set(ev.dates)].sort()) {
    let start = ev.startMin;
    for (; start + durationMin <= ev.endMin; start += durationMin) {
      const eligible: number[] = [];
      for (let index = 0; index < members.length; index++) {
        let available = true;
        for (let minute = start; minute < start + durationMin; minute += ev.slotMinutes) {
          if (!members[index].slots.has(slotId(date, minute))) { available = false; break; }
        }
        if (available) {
          eligible.push(index);
          members[index].eligibleBlocks++;
        }
      }
      rows.push({ date, start, eligible, assigned: new Set() });
    }
    if (start < ev.endMin) {
      remainders.push({ date, start: minToHHMM(start), end: minToHHMM(ev.endMin), minutes: ev.endMin - start });
    }
  }

  // Constrained blocks go first; participant ties favor fewer future opportunities.
  const scarcityOrder = rows.map((_, index) => index)
    .sort((a, b) => rows[a].eligible.length - rows[b].eligible.length || a - b);
  for (const rowIndex of scarcityOrder) {
    const row = rows[rowIndex];
    const choices = [...row.eligible].sort((a, b) =>
      members[a].assignedRows.size - members[b].assignedRows.size ||
      members[a].eligibleBlocks - members[b].eligibleBlocks || a - b);
    for (const personIndex of choices.slice(0, minPeople)) {
      row.assigned.add(personIndex);
      members[personIndex].assignedRows.add(rowIndex);
    }
  }

  const balanceLimited = balance(rows, members);
  const publicPerson = (index: number): AssignmentPerson => ({ id: members[index].id, name: members[index].name });
  return {
    blocks: rows.map((row) => ({
      id: slotId(row.date, row.start), date: row.date,
      start: minToHHMM(row.start), end: minToHHMM(row.start + durationMin), minutes: durationMin,
      eligible: row.eligible.map(publicPerson),
      assigned: [...row.assigned].sort((a, b) => a - b).map(publicPerson),
      missing: Math.max(0, minPeople - row.assigned.size),
    })),
    people: members.map((member) => ({
      id: member.id, name: member.name, count: member.assignedRows.size,
      minutes: member.assignedRows.size * durationMin, eligibleBlocks: member.eligibleBlocks,
    })),
    remainders,
    balanceLimited,
  };
}

function balance(rows: Row[], members: Member[]): boolean {
  let steps = 0;
  let improvements = 0;
  while (true) {
    const lowest = members.reduce((min, member) => member.eligibleBlocks ? Math.min(min, member.assignedRows.size) : min, Infinity);
    const donors = members.map((_, index) => index)
      .filter((index) => members[index].assignedRows.size >= lowest + 2)
      .sort((a, b) => members[b].assignedRows.size - members[a].assignedRows.size || a - b);
    if (!donors.length) return false;
    if (improvements >= MAX_IMPROVEMENTS) return true;

    let improved = false;
    for (const source of donors) {
      const seenPeople = new Uint8Array(members.length);
      const seenRows = new Uint8Array(rows.length);
      const previousPerson = new Int32Array(members.length).fill(-1);
      const previousRow = new Int32Array(members.length).fill(-1);
      const queue = [source];
      seenPeople[source] = 1;
      let target = -1;
      for (let head = 0; head < queue.length && target < 0; head++) {
        const current = queue[head];
        for (const rowIndex of members[current].assignedRows) {
          if (++steps > MAX_BALANCE_STEPS) return true;
          if (seenRows[rowIndex]) continue;
          seenRows[rowIndex] = 1;
          const row = rows[rowIndex];
          for (const next of row.eligible) {
            if (++steps > MAX_BALANCE_STEPS) return true;
            if (seenPeople[next] || row.assigned.has(next)) continue;
            seenPeople[next] = 1;
            previousPerson[next] = current;
            previousRow[next] = rowIndex;
            if (members[next].assignedRows.size <= members[source].assignedRows.size - 2) {
              target = next;
              break;
            }
            queue.push(next);
          }
          if (target >= 0) break;
        }
      }
      if (target < 0) continue;

      // Every row keeps its staffing count. Intermediate people trade one
      // assignment for another; only source (-1) and target (+1) change load.
      // The sum of squared counts strictly decreases, so paths cannot cycle.
      for (let current = target; current !== source; current = previousPerson[current]) {
        const prior = previousPerson[current];
        const rowIndex = previousRow[current];
        rows[rowIndex].assigned.delete(prior);
        rows[rowIndex].assigned.add(current);
        members[prior].assignedRows.delete(rowIndex);
        members[current].assignedRows.add(rowIndex);
      }
      improvements++;
      improved = true;
      break;
    }
    if (!improved) return false;
  }
}
