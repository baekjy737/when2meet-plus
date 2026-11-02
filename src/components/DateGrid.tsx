"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { dateLabel, pad } from "@/lib/slots";
import { applySelectionRange, nextCalendarDate } from "@/lib/grid-interaction";
import type { PublicEvent } from "@/lib/types";
import { useAvailabilityPaint, useGridEnvironment } from "./useAvailabilityPaint";

type Props = {
  event: PublicEvent;
  status?: string;
  selected?: Set<string>;
  onChange?: (next: Set<string>) => void;
  counts?: Map<string, number>;
  total?: number;
  highlight?: Set<string>;
  onHover?: (date: string | null) => void;
};
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** A chronological drag may span weeks/months, but never another calendar. */
export default function DateGrid({ event, status, selected, onChange, counts, total = 0, highlight, onHover }: Props) {
  const id = useId();
  const editable = !!selected && !!onChange;
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [focusedDate, setFocusedDate] = useState(event.dates[0]);
  const pendingFocus = useRef(false);
  const keyboardRange = useRef<{ anchor: string; base: Set<string>; adding: boolean } | null>(null);
  const { touchCapable, width, toolbarHeight } = useGridEnvironment(rootRef, toolbarRef);
  const input = useAvailabilityPaint({ rootRef, contentRef, toolbarRef, selected, onChange, onHover,
    range: (a, b) => event.dates.filter((date) => date >= (a < b ? a : b) && date <= (a > b ? a : b)),
    layoutKey: `${event.id}:${width}` });
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

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const button = rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`);
    button?.focus({ preventScroll: true });
    if (button) {
      const bounds = button.getBoundingClientRect();
      const top = Math.max(0, toolbarRef.current?.getBoundingClientRect().bottom ?? 0);
      if (bounds.top < top) window.scrollBy(0, bounds.top - top);
      else if (bounds.bottom > window.innerHeight) window.scrollBy(0, bounds.bottom - window.innerHeight);
    }
  }, [focusedDate]);
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, date: string) {
    if (e.key === "Enter" || e.key === " ") {
      keyboardRange.current = null;
      input.allowKeyboardClick();
      return;
    }
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!step[e.key]) return;
    e.preventDefault();
    input.cancel();
    const next = nextCalendarDate(event.dates, date, step[e.key]);
    if (e.shiftKey && selected && onChange) {
      keyboardRange.current ??= { anchor: date, base: new Set(selected), adding: !selected.has(date) };
      const range = keyboardRange.current;
      onChange(applySelectionRange(range.base, event.dates.filter((candidate) => candidate >= (range.anchor < next ? range.anchor : next) && candidate <= (range.anchor > next ? range.anchor : next)), range.adding));
    } else keyboardRange.current = null;
    pendingFocus.current = true;
    setFocusedDate(next);
    onHover?.(next);
  }

  return (
    <div ref={rootRef} className={`availability-editor${touchCapable ? " touch-capable" : ""}${input.paintMode ? " touch-paint" : ""}`} style={{ "--grid-toolbar-height": `${toolbarHeight}px` } as CSSProperties} onPointerDown={input.onPointerDown}>
      <div ref={toolbarRef} className="grid-toolbar">
        {status && <p className="grid-save-status" role="status">{status}</p>}
        {editable && touchCapable && <div className="grid-touch-tools">
          <button type="button" className={input.paintMode ? "primary" : ""} aria-pressed={input.paintMode} onClick={input.togglePaintMode}>{input.paintMode ? "선택 완료" : "여러 칸 선택"}</button>
          <span className="grid-help">{input.paintMode ? "선택 모드 · 드래그를 마치면 자동 저장돼요. 화면 끝에서 다음 달까지 칠할 수 있어요." : "탭: 한 날짜 선택 · 여러 날짜는 ‘여러 칸 선택’을 켜고 드래그"}</span>
        </div>}
      </div>
      <div ref={contentRef} className={`date-calendars ${editable ? "date-calendars-editable" : ""}`}>
        {months.map(({ month, title, cells }) => <section className="date-calendar" key={month} aria-labelledby={`${id}-${month}`}>
          <h3 id={`${id}-${month}`}>{title}</h3>
          <div className="date-calendar-grid">
            {WEEK.map((weekday) => <div key={weekday} className="cal-wd" aria-hidden="true">{weekday}</div>)}
            {cells.map((date, index) => {
              if (!date) return <span key={`empty-${index}`} aria-hidden="true" />;
              const day = Number(date.slice(8));
              if (!availableDates.has(date)) return <span key={date} className="date-outside" aria-hidden="true">{day}</span>;
              const isSelected = input.shown?.has(date) ?? false;
              const count = counts?.get(date) ?? 0;
              const label = `${date.slice(0, 4)}년 ${dateLabel(date)}`;
              return <button type="button" key={date} data-selection-key={date} data-date={date} tabIndex={date === focusedDate ? 0 : -1}
                className={`date-cell${isSelected ? " on" : ""}${highlight?.has(date) ? " hl" : ""}${!editable && total > 0 && count === total ? " full" : ""}`}
                style={editable ? undefined : { "--heat": total ? count / total : 0 } as CSSProperties}
                aria-label={editable ? `${label}, ${isSelected ? "가능" : "미선택"}` : `${label}, ${total}명 중 ${count}명 가능`}
                aria-pressed={editable ? isSelected : undefined}
                onClick={(e) => input.onCellClick(e, date)}
                onKeyDown={(e) => onKeyDown(e, date)}
                onKeyUp={(e) => { if (e.key === "Shift") keyboardRange.current = null; }}
                onFocus={() => { setFocusedDate(date); onHover?.(date); }}
                onPointerEnter={(e) => { if (e.pointerType !== "touch") onHover?.(date); }}>
                <span className="date-number">{day}</span>
                <span className="date-cell-status" aria-hidden="true">{editable ? (isSelected ? "✓ 가능" : "선택") : `${count}/${total}`}</span>
              </button>;
            })}
          </div>
        </section>)}
      </div>
    </div>
  );
}
