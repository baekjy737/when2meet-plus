"use client";

import { useRef, useState } from "react";
import { dateLabel, minToHHMM, slotId, slotMinutes } from "@/lib/slots";
import type { PublicEvent } from "@/lib/types";

type Props = {
  event: PublicEvent;
  /** Edit mode: selected slots + change handler. */
  selected?: Set<string>;
  onChange?: (next: Set<string>) => void;
  /** View mode: available count per slot. */
  counts?: Map<string, number>;
  total?: number;
  highlight?: Set<string>;
  onHover?: (slot: string | null) => void;
};

type Cell = { d: number; r: number };

export default function Grid({ event, selected, onChange, counts, total = 0, highlight, onHover }: Props) {
  const rows = slotMinutes(event);
  const editable = !!onChange && !!selected;
  const drag = useRef<{ start: Cell; adding: boolean; base: Set<string> } | null>(null);
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const shown = preview ?? selected;

  const cellAt = (x: number, y: number): Cell | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const td = el?.closest<HTMLElement>("[data-d]");
    return td ? { d: Number(td.dataset.d), r: Number(td.dataset.r) } : null;
  };

  const rect = (a: Cell, b: Cell) => {
    const out: string[] = [];
    for (let d = Math.min(a.d, b.d); d <= Math.max(a.d, b.d); d++)
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) out.push(slotId(event.dates[d], rows[r]));
    return out;
  };

  const paint = (cur: Cell) => {
    const g = drag.current!;
    const next = new Set(g.base);
    for (const s of rect(g.start, cur)) g.adding ? next.add(s) : next.delete(s);
    setPreview(next);
    return next;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable) return;
    const c = cellAt(e.clientX, e.clientY);
    if (!c) return;
    e.preventDefault();
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    drag.current = { start: c, adding: !selected.has(slotId(event.dates[c.d], rows[c.r])), base: new Set(selected) };
    paint(c);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const c = cellAt(e.clientX, e.clientY);
    if (drag.current) {
      if (c) paint(c);
    } else if (onHover) {
      onHover(c ? slotId(event.dates[c.d], rows[c.r]) : null);
    }
  };

  const finish = () => {
    if (drag.current && preview) onChange?.(preview);
    drag.current = null;
    setPreview(null);
  };

  return (
    <div className="grid-wrap">
      <table
        className={`grid ${editable ? "editable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => { finish(); onHover?.(null); }}
      >
        <thead>
          <tr>
            <th />
            {event.dates.map((d) => <th key={d}>{dateLabel(d)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((m, r) => (
            <tr key={m} className={m % 60 === 0 ? "hour" : ""}>
              <th className="time">{m % 60 === 0 ? minToHHMM(m) : ""}</th>
              {event.dates.map((date, d) => {
                const id = slotId(date, m);
                let style: React.CSSProperties | undefined;
                let cls = "cell";
                if (shown) {
                  if (shown.has(id)) cls += " on";
                } else if (counts) {
                  const n = counts.get(id) ?? 0;
                  style = { ["--heat" as string]: total ? n / total : 0 };
                  if (total && n === total) cls += " full";
                }
                if (highlight?.has(id)) cls += " hl";
                return <td key={date} data-d={d} data-r={r} className={cls} style={style} title={`${dateLabel(date)} ${minToHHMM(m)}`} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
