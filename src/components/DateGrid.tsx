"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { dateLabel, pad } from "@/lib/slots";
import type { PublicEvent } from "@/lib/types";

type Props = {
  event: PublicEvent;
  selected?: Set<string>;
  onChange?: (next: Set<string>) => void;
  counts?: Map<string, number>;
  total?: number;
  highlight?: Set<string>;
  onHover?: (date: string | null) => void;
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

type Drag = {
  anchor: string;
  adding: boolean;
  base: Set<string>;
  next: Set<string>;
  source: "pointer" | "touch";
  id: number;
};

/** Date-only calendar. Drag selects a chronological range across weeks and months. */
export default function DateGrid({ event, selected, onChange, counts, total = 0, highlight, onHover }: Props) {
  const id = useId();
  const editable = !!selected && !!onChange;
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClickUntil = useRef(0);
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const shown = preview ?? selected;
  const availableDates = useMemo(() => new Set(event.dates), [event.dates]);
  const months = useMemo(() => [...new Set(event.dates.map((date) => date.slice(0, 7)))].sort().map((month) => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const last = new Date(first);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    const cells: (string | null)[] = [
      ...Array(first.getUTCDay()).fill(null),
      ...Array.from({ length: last.getUTCDate() }, (_, day) => `${month}-${pad(day + 1)}`),
    ];
    while (cells.length % 7) cells.push(null);
    return { month, title: `${first.getUTCFullYear()}년 ${first.getUTCMonth() + 1}월`, cells };
  }), [event.dates]);

  function dateAt(x: number, y: number): string | null {
    const button = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-date]");
    // An event page contains both an editable calendar and a group calendar.
    if (!button || !containerRef.current?.contains(button)) return null;
    const date = button.dataset.date;
    return date && availableDates.has(date) ? date : null;
  }

  function paint(date: string) {
    const active = drag.current;
    if (!active) return;
    const first = active.anchor < date ? active.anchor : date;
    const last = active.anchor > date ? active.anchor : date;
    const next = new Set(active.base);
    for (const candidate of event.dates) {
      if (candidate >= first && candidate <= last) active.adding ? next.add(candidate) : next.delete(candidate);
    }
    // Preserve the fast-gesture fix from 59e5108: release may precede React's
    // render, so the committed selection must come from this ref, not preview.
    active.next = next;
    setPreview(next);
    onHover?.(date);
  }

  function begin(date: string, source: Drag["source"], inputId: number) {
    if (!editable || drag.current) return;
    suppressClickUntil.current = Infinity;
    drag.current = { anchor: date, adding: !selected.has(date), base: new Set(selected), next: new Set(selected), source, id: inputId };
    paint(date);
  }

  function finish() {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    suppressClickUntil.current = Date.now() + 800;
    setPreview(null);
    onChange?.(active.next);
  }

  const inputApi = useRef({ begin, paint, finish, dateAt });
  inputApi.current = { begin, paint, finish, dateAt };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !editable) return;

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const active = drag.current;
      if (active?.source !== "pointer" || active.id !== e.pointerId) return;
      const date = inputApi.current.dateAt(e.clientX, e.clientY);
      if (date) inputApi.current.paint(date);
    };
    const onPointerEnd = (e: PointerEvent) => {
      // dbd364f: iOS may cancel touch-derived pointers while native touch
      // painting is still active. Never finish that gesture from pointer events.
      if (e.pointerType === "touch") return;
      if (drag.current?.source === "pointer" && drag.current.id === e.pointerId) inputApi.current.finish();
    };
    // 59e5108 + dbd364f: CSS touch-action alone is insufficient in iOS scrollers.
    // Use non-passive native touch events for both painting and completion.
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const date = inputApi.current.dateAt(touch.clientX, touch.clientY);
      if (!date) return;
      e.preventDefault();
      inputApi.current.begin(date, "touch", touch.identifier);
    };
    const onTouchMove = (e: TouchEvent) => {
      const active = drag.current;
      if (active?.source !== "touch") return;
      const touch = Array.from(e.touches).find((item) => item.identifier === active.id);
      if (!touch) return;
      e.preventDefault();
      const date = inputApi.current.dateAt(touch.clientX, touch.clientY);
      if (date) inputApi.current.paint(date);
    };
    const onTouchEnd = (e: TouchEvent) => {
      const active = drag.current;
      if (active?.source === "touch" && !Array.from(e.touches).some((item) => item.identifier === active.id)) inputApi.current.finish();
    };
    const onBlur = () => inputApi.current.finish();

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    window.addEventListener("blur", onBlur);
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("blur", onBlur);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [editable]);

  function choose(date: string) {
    if (editable) {
      const next = new Set(selected);
      next.has(date) ? next.delete(date) : next.add(date);
      onChange(next);
    }
    onHover?.(date);
  }

  return (
    <div
      ref={containerRef}
      className={`date-calendars ${editable ? "date-calendars-editable" : ""}`}
      onPointerDown={(e) => {
        if (!editable || e.pointerType === "touch" || e.button !== 0) return;
        const date = dateAt(e.clientX, e.clientY);
        if (!date) return;
        e.preventDefault();
        (e.target as HTMLElement).closest<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        begin(date, "pointer", e.pointerId);
      }}
    >
      {months.map(({ month, title, cells }) => (
        <section className="date-calendar" key={month} aria-labelledby={`${id}-${month}`}>
          <h3 id={`${id}-${month}`}>{title}</h3>
          <div className="date-calendar-grid">
            {WEEK.map((weekday) => <div key={weekday} className="cal-wd" aria-hidden="true">{weekday}</div>)}
            {cells.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} aria-hidden="true" />;
              const day = Number(date.slice(8));
              if (!availableDates.has(date)) return <span key={date} className="date-outside" aria-hidden="true">{day}</span>;
              const isSelected = shown?.has(date) ?? false;
              const count = counts?.get(date) ?? 0;
              const label = `${date.slice(0, 4)}년 ${dateLabel(date)}`;
              const style = { "--heat": total ? count / total : 0 } as CSSProperties;
              return (
                <button
                  type="button" key={date} data-date={date}
                  className={`date-cell${isSelected ? " on" : ""}${highlight?.has(date) ? " hl" : ""}${!editable && total > 0 && count === total ? " full" : ""}`}
                  style={editable ? undefined : style}
                  aria-label={editable ? `${label}, ${isSelected ? "가능" : "미선택"}` : `${label}, ${total}명 중 ${count}명 가능`}
                  aria-pressed={editable ? isSelected : undefined}
                  onClick={(e) => {
                    // Pointer/touch input already committed at release; swallow
                    // its compatibility click, including detail=0 touch clicks.
                    if (editable && (e.detail !== 0 || Date.now() < suppressClickUntil.current)) return;
                    choose(date);
                  }}
                  onKeyDown={(e) => {
                    // Enter/Space still use the native button click exactly once.
                    if (e.key === "Enter" || e.key === " ") suppressClickUntil.current = 0;
                  }}
                  onFocus={() => onHover?.(date)}
                  onPointerEnter={() => onHover?.(date)}
                >
                  <span className="date-number">{day}</span>
                  <span className="date-cell-status" aria-hidden="true">{editable ? (isSelected ? "✓ 가능" : "선택") : `${count}/${total}`}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
