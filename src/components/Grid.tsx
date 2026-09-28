"use client";

import { useEffect, useRef, useState } from "react";
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
  // `next` mirrors `preview` so the drag end sees the latest paint even before React re-renders.
  const drag = useRef<{ start: Cell; adding: boolean; base: Set<string>; next: Set<string> } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
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
    const g = drag.current;
    if (!g) return;
    const next = new Set(g.base);
    for (const s of rect(g.start, cur)) g.adding ? next.add(s) : next.delete(s);
    g.next = next;
    setPreview(next);
  };

  const begin = (c: Cell) => {
    if (!selected) return;
    drag.current = { start: c, adding: !selected.has(slotId(event.dates[c.d], rows[c.r])), base: new Set(selected), next: new Set(selected) };
    paint(c);
  };

  const finish = () => {
    if (drag.current) onChange?.(drag.current.next);
    drag.current = null;
    setPreview(null);
  };

  // Touch is handled with native touch events rather than pointer events: iOS Safari
  // may cancel or retarget touch-derived pointer events, leaving only the first cell
  // painted. Listeners are non-passive so they can stop the page from scrolling.
  const touchApi = useRef({ begin, paint, finish, cellAt });
  touchApi.current = { begin, paint, finish, cellAt };
  useEffect(() => {
    const table = tableRef.current;
    if (!table || !editable) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const c = touchApi.current.cellAt(t.clientX, t.clientY);
      if (!c) return;
      e.preventDefault();
      touchApi.current.begin(c);
    };
    const onMove = (e: TouchEvent) => {
      if (!drag.current) return;
      e.preventDefault();
      const t = e.touches[0];
      const c = touchApi.current.cellAt(t.clientX, t.clientY);
      if (c) touchApi.current.paint(c);
    };
    const onEnd = () => touchApi.current.finish();
    table.addEventListener("touchstart", onStart, { passive: false });
    table.addEventListener("touchmove", onMove, { passive: false });
    table.addEventListener("touchend", onEnd);
    table.addEventListener("touchcancel", onEnd);
    return () => {
      table.removeEventListener("touchstart", onStart);
      table.removeEventListener("touchmove", onMove);
      table.removeEventListener("touchend", onEnd);
      table.removeEventListener("touchcancel", onEnd);
    };
  }, [editable]);

  // Mouse and pen.
  const onPointerDown = (e: React.PointerEvent) => {
    const c = cellAt(e.clientX, e.clientY);
    if (!editable) {
      // No hover on touch screens: a tap shows that slot's details instead.
      if (e.pointerType === "touch") onHover?.(c ? slotId(event.dates[c.d], rows[c.r]) : null);
      return;
    }
    if (e.pointerType === "touch" || e.button !== 0) return;
    if (!c) return;
    e.preventDefault();
    begin(c);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const c = cellAt(e.clientX, e.clientY);
    if (drag.current) {
      if (c) paint(c);
    } else if (onHover) {
      onHover(c ? slotId(event.dates[c.d], rows[c.r]) : null);
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") finish();
  };

  return (
    <div className="grid-wrap">
      <table
        ref={tableRef}
        className={`grid ${editable ? "editable" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={(e) => {
          if (e.pointerType === "touch") return;
          finish();
          onHover?.(null);
        }}
      >
        <thead>
          <tr>
            <th />
            {event.dates.map((d) => {
              const [day, weekday] = dateLabel(d).split(" ");
              return <th key={d} className="day">{day}<br />{weekday}</th>;
            })}
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
