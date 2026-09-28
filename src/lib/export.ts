import ExcelJS from "exceljs";
import { bestBlocks, slotStats, type Block } from "./analysis";
import { allSlots, dateLabel } from "./slots";
import type { PublicEvent, PublicParticipant } from "./types";

export type ExportOptions = { durationMin?: number; minPeople?: number; limit?: number };

export function exportJson(ev: PublicEvent, people: PublicParticipant[], opts: ExportOptions) {
  return {
    event: {
      id: ev.id, name: ev.name, timezone: ev.timezone, slotMinutes: ev.slotMinutes,
      dates: ev.dates, start: ev.startMin, end: ev.endMin,
    },
    participants: people.map((p) => ({ name: p.name, slots: p.slots })),
    bestTimes: bestBlocks(ev, people, { ...opts, limit: opts.limit ?? 20 }),
    slots: slotStats(ev, people).map((s) => ({ ...s, count: s.available.length })),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(",");

/** One row per slot: date, time range, count, available names, unavailable names. */
export function exportCsv(ev: PublicEvent, people: PublicParticipant[]): string {
  const lines = [csvRow(["date", "start", "end", "count", "total", "available", "unavailable"])];
  for (const s of slotStats(ev, people)) {
    lines.push(csvRow([s.date, s.start, s.end, s.available.length, people.length, s.available.join("; "), s.unavailable.join("; ")]));
  }
  // BOM so Excel opens Korean text correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function heatColor(ratio: number): string {
  // White → green.
  const g = (c: number) => Math.round(255 - (255 - c) * ratio).toString(16).padStart(2, "0");
  return `FF${g(34)}${g(160)}${g(90)}`.toUpperCase();
}

export async function exportXlsx(ev: PublicEvent, people: PublicParticipant[], opts: ExportOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const total = people.length;

  // 1) Best times
  const best = wb.addWorksheet("최적 시간");
  best.columns = [
    { header: "순위", key: "rank", width: 6 },
    { header: "날짜", key: "date", width: 12 },
    { header: "시작", key: "start", width: 8 },
    { header: "종료", key: "end", width: 8 },
    { header: "가능 인원", key: "count", width: 10 },
    { header: "전체", key: "total", width: 6 },
    { header: "가능", key: "available", width: 50 },
    { header: "불가", key: "unavailable", width: 40 },
  ];
  bestBlocks(ev, people, { ...opts, limit: opts.limit ?? 50 }).forEach((b: Block, i) => {
    best.addRow({
      rank: i + 1, date: dateLabel(b.date), start: b.start, end: b.end, count: b.available.length, total,
      available: b.available.join(", "), unavailable: b.unavailable.join(", "),
    });
  });
  styleHeader(best);

  // 2) Per-slot counts
  const bySlot = wb.addWorksheet("시간대별");
  bySlot.columns = [
    { header: "날짜", key: "date", width: 12 },
    { header: "시작", key: "start", width: 8 },
    { header: "종료", key: "end", width: 8 },
    { header: "가능 인원", key: "count", width: 10 },
    { header: "가능", key: "available", width: 60 },
    { header: "불가", key: "unavailable", width: 40 },
  ];
  for (const s of slotStats(ev, people)) {
    const row = bySlot.addRow({
      date: dateLabel(s.date), start: s.start, end: s.end, count: s.available.length,
      available: s.available.join(", "), unavailable: s.unavailable.join(", "),
    });
    if (total) row.getCell("count").fill = { type: "pattern", pattern: "solid", fgColor: { argb: heatColor(s.available.length / total) } };
  }
  styleHeader(bySlot);
  bySlot.autoFilter = { from: "A1", to: "F1" };

  // 3) Participant × slot matrix (1 = available)
  const matrix = wb.addWorksheet("매트릭스");
  const slots = allSlots(ev);
  matrix.addRow(["이름", ...slots.map((s) => s.replace("T", " "))]);
  for (const p of people) {
    const set = new Set(p.slots);
    matrix.addRow([p.name, ...slots.map((s) => (set.has(s) ? 1 : 0))]);
  }
  matrix.getColumn(1).width = 14;
  styleHeader(matrix);
  matrix.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
