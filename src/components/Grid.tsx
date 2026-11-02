"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { dateLabel, minToHHMM, slotId, slotMinutes } from "@/lib/slots";
import { applySelectionRange, pageContaining, visibleDateCount } from "@/lib/grid-interaction";
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
  onHover?: (slot: string | null) => void;
};
type Cell = { d: number; r: number };

export default function Grid({ event, status, selected, onChange, counts, total = 0, highlight, onHover }: Props) {
  const rows = useMemo(() => slotMinutes(event), [event]);
  const editable = !!onChange && !!selected;
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLTableSectionElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const { touchCapable, width, toolbarHeight } = useGridEnvironment(rootRef, toolbarRef);
  const pageSize = visibleDateCount(width, 52, touchCapable ? 56 : 28, event.dates.length);
  const [anchorDay, setAnchorDay] = useState(0);
  const start = pageContaining(anchorDay, pageSize, event.dates.length);
  const end = Math.min(event.dates.length, start + pageSize);
  const dates = event.dates.slice(start, end);
  const previousLayout = useRef({ pageSize, start });
  useEffect(() => {
    if (previousLayout.current.pageSize !== pageSize) setAnchorDay(previousLayout.current.start);
    previousLayout.current = { pageSize, start };
  }, [pageSize, start]);
  const [focus, setFocus] = useState<Cell>({ d: 0, r: 0 });
  const pendingFocus = useRef(false);
  const keyboardRange = useRef<{ anchor: Cell; base: Set<string>; adding: boolean } | null>(null);
  const focused = { d: Math.max(start, Math.min(end - 1, focus.d)), r: Math.max(0, Math.min(rows.length - 1, focus.r)) };
  const cells = useMemo(() => new Map(event.dates.flatMap((date, d) => rows.map((minute, r) => [slotId(date, minute), { d, r }] as const))), [event.dates, rows]);

  function rectangle(a: Cell, b: Cell): string[] {
    const result: string[] = [];
    for (let d = Math.min(a.d, b.d); d <= Math.max(a.d, b.d); d++) {
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) result.push(slotId(event.dates[d], rows[r]));
    }
    return result;
  }
  const input = useAvailabilityPaint({ rootRef, contentRef, toolbarRef, headerRef, selected, onChange, onHover,
    range: (a, b) => cells.has(a) && cells.has(b) ? rectangle(cells.get(a)!, cells.get(b)!) : [],
    layoutKey: `${event.id}:${width}:${start}:${pageSize}` });

  // React to a changed result highlight, not ordinary renders/manual pagination.
  const highlightedDate = event.dates.find((date) => [...(highlight ?? [])].some((key) => key.startsWith(`${date}T`)));
  const highlightedIndex = highlightedDate ? event.dates.indexOf(highlightedDate) : -1;
  useEffect(() => {
    if (highlightedIndex >= 0) setAnchorDay(highlightedIndex);
  }, [highlightedDate, highlightedIndex]);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const button = rootRef.current?.querySelector<HTMLButtonElement>(`[data-d="${focused.d}"][data-r="${focused.r}"]`);
    button?.focus({ preventScroll: true });
    if (button) {
      const bounds = button.getBoundingClientRect();
      const top = Math.max(0, headerRef.current?.getBoundingClientRect().bottom ?? 0);
      if (bounds.top < top) window.scrollBy(0, bounds.top - top);
      else if (bounds.bottom > window.innerHeight) window.scrollBy(0, bounds.bottom - window.innerHeight);
    }
  }, [focus, start, focused.d, focused.r]);
  useEffect(() => { keyboardRange.current = null; }, [pageSize]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, current: Cell) {
    if (e.key === " " || e.key === "Enter") {
      keyboardRange.current = null;
      input.allowKeyboardClick();
      return; // Native buttons activate exactly once (Space on keyup).
    }
    const delta: Record<string, Cell> = { ArrowLeft: { d: -1, r: 0 }, ArrowRight: { d: 1, r: 0 }, ArrowUp: { d: 0, r: -1 }, ArrowDown: { d: 0, r: 1 } };
    const movement = delta[e.key];
    if (!movement) return;
    e.preventDefault();
    input.cancel();
    const next = { d: Math.max(0, Math.min(event.dates.length - 1, current.d + movement.d)), r: Math.max(0, Math.min(rows.length - 1, current.r + movement.r)) };
    if (e.shiftKey && selected && onChange) {
      keyboardRange.current ??= { anchor: current, base: new Set(selected), adding: !selected.has(slotId(event.dates[current.d], rows[current.r])) };
      const range = keyboardRange.current;
      onChange(applySelectionRange(range.base, rectangle(range.anchor, next), range.adding));
    } else keyboardRange.current = null;
    pendingFocus.current = true;
    setFocus(next);
    if (next.d < start || next.d >= end) setAnchorDay(next.d);
    onHover?.(slotId(event.dates[next.d], rows[next.r]));
  }

  return (
    <div ref={rootRef} className={`availability-editor grid-wrap${touchCapable ? " touch-capable" : ""}${input.paintMode ? " touch-paint" : ""}`} style={{ "--grid-toolbar-height": `${toolbarHeight}px` } as CSSProperties} onPointerDown={input.onPointerDown}>
      <div ref={toolbarRef} className="grid-toolbar">
        {status && <p className="grid-save-status" role="status">{status}</p>}
        {editable && touchCapable && <div className="grid-touch-tools">
          <button type="button" className={input.paintMode ? "primary" : ""} aria-pressed={input.paintMode} onClick={input.togglePaintMode}>{input.paintMode ? "선택 완료" : "여러 칸 선택"}</button>
          <span className="grid-help">{input.paintMode ? "선택 모드 · 드래그를 마치면 자동 저장돼요. 화면 끝에서 계속 칠할 수 있어요." : "탭: 한 칸 선택 · 여러 칸은 ‘여러 칸 선택’을 켜고 드래그"}</span>
        </div>}
        {pageSize < event.dates.length && <nav className="grid-pagination" aria-label="시간표 날짜 이동">
          <button type="button" disabled={start === 0} onClick={() => { input.cancel(); keyboardRange.current = null; setAnchorDay(Math.max(0, start - pageSize)); }}>이전 날짜</button>
          <span aria-live="polite">{start + 1}–{end}일 / 전체 {event.dates.length}일<br /><small>{dateLabel(dates[0])} – {dateLabel(dates[dates.length - 1])}</small></span>
          <button type="button" disabled={end === event.dates.length} onClick={() => { input.cancel(); keyboardRange.current = null; setAnchorDay(end); }}>다음 날짜</button>
        </nav>}
      </div>
      <table className={`grid ${editable ? "editable" : ""}`} aria-label={editable ? "가능한 시간 선택" : "시간별 참여 가능 인원"}>
        <colgroup><col style={{ width: 52 }} />{dates.map((date) => <col key={date} />)}</colgroup>
        <thead ref={headerRef}><tr><th scope="col"><span className="visually-hidden">시각</span></th>{dates.map((date) => {
          const [day, weekday] = dateLabel(date).split(" ");
          return <th scope="col" key={date} className="day">{day}<br />{weekday}</th>;
        })}</tr></thead>
        <tbody ref={contentRef}>
          {rows.map((minute, r) => <tr key={minute} className={minute % 60 === 0 ? "hour" : ""}>
            <th scope="row" className="time">{r === 0 || minute % 60 === 0 ? minToHHMM(minute) : <span className="visually-hidden">{minToHHMM(minute)}</span>}</th>
            {dates.map((date, offset) => {
              const d = start + offset;
              const key = slotId(date, minute);
              const count = counts?.get(key) ?? 0;
              const isSelected = input.shown?.has(key) ?? false;
              const label = `${date} ${dateLabel(date)} ${minToHHMM(minute)}–${minToHHMM(minute + event.slotMinutes)}, ${editable ? (isSelected ? "가능" : "미선택") : `${total}명 중 ${count}명 가능`}`;
              const cls = `cell${isSelected ? " on" : ""}${!editable && total > 0 && count === total ? " full" : ""}${highlight?.has(key) ? " hl" : ""}`;
              return <td key={date} className={cls} style={!editable ? { "--heat": total ? count / total : 0 } as CSSProperties : undefined}>
                <button type="button" className="grid-cell-button" data-selection-key={key} data-d={d} data-r={r} tabIndex={focused.d === d && focused.r === r ? 0 : -1}
                  aria-label={label} aria-pressed={editable ? isSelected : undefined} title={label}
                  onClick={(e) => input.onCellClick(e, key)} onKeyDown={(e) => onKeyDown(e, { d, r })}
                  onKeyUp={(e) => { if (e.key === "Shift") keyboardRange.current = null; }}
                  onFocus={() => { setFocus({ d, r }); onHover?.(key); }}
                  onPointerEnter={(e) => { if (e.pointerType !== "touch") onHover?.(key); }} />
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}
