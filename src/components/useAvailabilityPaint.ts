"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { applySelectionRange, edgeScrollVelocity } from "@/lib/grid-interaction";

type ElementRef = RefObject<HTMLElement | null>;
type Options = {
  rootRef: ElementRef;
  contentRef: ElementRef;
  toolbarRef: ElementRef;
  headerRef?: ElementRef;
  selected?: Set<string>;
  onChange?: (next: Set<string>) => void;
  onHover?: (key: string | null) => void;
  range: (anchor: string, target: string) => string[];
  layoutKey: string;
};
type Drag = {
  source: "pointer" | "touch";
  id: number;
  anchor: string;
  base: Set<string>;
  next: Set<string>;
  adding: boolean;
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
};
type Tap = { id: number; x: number; y: number; scrollY: number; canceled: boolean };

export function useGridEnvironment(rootRef: ElementRef, toolbarRef: ElementRef) {
  const [touchCapable, setTouchCapable] = useState(false);
  const [width, setWidth] = useState(320);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useEffect(() => {
    const media = window.matchMedia("(any-pointer: coarse)");
    const update = () => {
      const touch = media.matches || navigator.maxTouchPoints > 0;
      setTouchCapable(touch);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const measure = () => {
      if (rootRef.current) setWidth(Math.floor(rootRef.current.getBoundingClientRect().width));
      setToolbarHeight(toolbarRef.current?.getBoundingClientRect().height ?? 0);
    };
    const observer = new ResizeObserver(measure);
    if (rootRef.current) observer.observe(rootRef.current);
    if (toolbarRef.current) observer.observe(toolbarRef.current);
    measure();
    return () => observer.disconnect();
  }, [rootRef, toolbarRef]);
  return { touchCapable, width, toolbarHeight };
}

/** Native touch painting preserves the iOS fixes in 59e5108/dbd364f.
 * Default touch input never blocks scrolling; only explicit paint mode does. */
export function useAvailabilityPaint(options: Options) {
  const { rootRef, contentRef, toolbarRef, headerRef, selected, onChange, layoutKey } = options;
  const editable = !!selected && !!onChange;
  const [paintMode, setPaintMode] = useState(false);
  const [preview, setPreview] = useState<Set<string> | null>(null);
  const active = useRef<Drag | null>(null);
  const tap = useRef<Tap | null>(null);
  const suppressClickUntil = useRef(0);
  const frame = useRef<number | null>(null);
  const api = useRef(options);
  api.current = options;

  function keyAt(x: number, y: number): string | null {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-selection-key]");
    return element && contentRef.current?.contains(element) ? element.dataset.selectionKey ?? null : null;
  }
  function paint(key: string) {
    const drag = active.current;
    if (!drag) return;
    drag.next = applySelectionRange(drag.base, api.current.range(drag.anchor, key), drag.adding);
    setPreview(drag.next);
    api.current.onHover?.(key);
  }
  function stopFrame() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }
  function finish(commit: boolean) {
    const drag = active.current;
    active.current = null;
    stopFrame();
    if (!drag) return;
    suppressClickUntil.current = Date.now() + 700;
    setPreview(null);
    // The ref, rather than rendered preview, includes the last fast move/release.
    if (commit) api.current.onChange?.(drag.next);
  }
  function begin(key: string, source: Drag["source"], id: number, x: number, y: number) {
    const current = api.current.selected;
    if (!current || !api.current.onChange || active.current) return;
    suppressClickUntil.current = Infinity;
    active.current = { source, id, anchor: key, base: new Set(current), next: new Set(current), adding: !current.has(key), x, y, startX: x, startY: y, moved: false };
    paint(key);
  }
  function startAutoScroll() {
    if (frame.current !== null) return;
    let previous = 0;
    const tick = (time: number) => {
      frame.current = null;
      const drag = active.current;
      const content = contentRef.current;
      if (!drag || drag.source !== "touch" || !drag.moved || !content) return;
      const bounds = content.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const bottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const top = Math.max(viewportTop, toolbarRef.current?.getBoundingClientRect().bottom ?? viewportTop, headerRef?.current?.getBoundingClientRect().bottom ?? viewportTop);
      const speed = drag.x >= bounds.left && drag.x <= bounds.right ? edgeScrollVelocity(drag.y, top, bottom, bounds.top, bounds.bottom) : 0;
      const elapsed = previous ? Math.min(32, time - previous) : 16;
      previous = time;
      if (speed) {
        const delta = speed * elapsed / 1000;
        const limited = delta < 0 ? Math.max(delta, bounds.top - top) : Math.min(delta, bounds.bottom - bottom);
        window.scrollBy(0, limited);
        // A stationary finger must keep painting as new rows scroll underneath.
        const key = keyAt(drag.x, Math.max(top + 1, Math.min(bottom - 1, drag.y)));
        if (key) paint(key);
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  const actions = useRef({ begin, paint, finish, keyAt, startAutoScroll });
  actions.current = { begin, paint, finish, keyAt, startAutoScroll };

  useEffect(() => {
    // Width/layout changes cancel only the unfinished gesture. Height changes do
    // not change layoutKey, so browser address-bar movement is harmless.
    actions.current.finish(false);
  }, [layoutKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cancel = () => {
      if (tap.current) tap.current.canceled = true;
      suppressClickUntil.current = Date.now() + 700;
      actions.current.finish(false);
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = active.current;
      if (event.pointerType === "touch" || drag?.source !== "pointer" || drag.id !== event.pointerId) return;
      const key = actions.current.keyAt(event.clientX, event.clientY);
      if (key) actions.current.paint(key);
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = active.current;
      if (event.pointerType === "touch" || drag?.source !== "pointer" || drag.id !== event.pointerId) return;
      const key = actions.current.keyAt(event.clientX, event.clientY);
      if (key) actions.current.paint(key);
      actions.current.finish(true);
    };
    const onPointerCancel = (event: PointerEvent) => {
      // iOS touch-derived pointercancel is NOT native touch cancellation.
      if (event.pointerType !== "touch" && active.current?.source === "pointer" && active.current.id === event.pointerId) cancel();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = event.touches[0];
      const key = actions.current.keyAt(touch.clientX, touch.clientY);
      if (!key) return;
      suppressClickUntil.current = 0;
      tap.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, scrollY: window.scrollY, canceled: false };
      if (paintMode && editable) {
        event.preventDefault();
        actions.current.begin(key, "touch", touch.identifier, touch.clientX, touch.clientY);
      }
    };
    const onSecondTouch = (event: TouchEvent) => { if (event.touches.length > 1 && (active.current || tap.current)) cancel(); };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { if (active.current || tap.current) cancel(); return; }
      const candidate = tap.current;
      const touch = Array.from(event.touches).find((item) => item.identifier === (active.current?.id ?? candidate?.id));
      if (!touch) return;
      const drag = active.current;
      if (drag?.source === "touch") {
        if (!event.cancelable) { cancel(); return; }
        event.preventDefault();
        drag.x = touch.clientX;
        drag.y = touch.clientY;
        drag.moved ||= Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 4;
        const key = actions.current.keyAt(drag.x, drag.y);
        if (key) actions.current.paint(key);
        if (drag.moved) actions.current.startAutoScroll();
      } else if (candidate && Math.hypot(touch.clientX - candidate.x, touch.clientY - candidate.y) > 8) {
        candidate.canceled = true;
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      const drag = active.current;
      if (drag?.source === "touch" && !Array.from(event.touches).some((touch) => touch.identifier === drag.id)) {
        const last = Array.from(event.changedTouches).find((touch) => touch.identifier === drag.id);
        const key = last && actions.current.keyAt(last.clientX, last.clientY);
        if (key) actions.current.paint(key);
        actions.current.finish(true);
      }
      if (tap.current && !Array.from(event.touches).some((touch) => touch.identifier === tap.current?.id)) {
        if (tap.current.canceled || Math.abs(window.scrollY - tap.current.scrollY) > 1) suppressClickUntil.current = Date.now() + 700;
        tap.current = null;
      }
    };
    const onVisibility = () => { if (document.hidden) cancel(); };
    const onScroll = () => { if (tap.current && !active.current) tap.current.canceled = true; };
    const touchOptions = { passive: !(paintMode && editable) };
    root.addEventListener("touchstart", onTouchStart, touchOptions);
    window.addEventListener("touchstart", onSecondTouch, { passive: true });
    window.addEventListener("touchmove", onTouchMove, touchOptions);
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", cancel);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchstart", onSecondTouch);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", cancel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      actions.current.finish(false);
      tap.current = null;
    };
  }, [rootRef, editable, paintMode]);

  function onPointerDown(event: ReactPointerEvent) {
    if (!editable || event.pointerType === "touch" || event.button !== 0) return;
    const key = keyAt(event.clientX, event.clientY);
    if (!key) return;
    event.preventDefault();
    (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    begin(key, "pointer", event.pointerId, event.clientX, event.clientY);
  }
  function onCellClick(_event: MouseEvent, key: string) {
    if (Date.now() < suppressClickUntil.current) return;
    const current = api.current.selected;
    if (current && api.current.onChange) api.current.onChange(applySelectionRange(current, [key], !current.has(key)));
    api.current.onHover?.(key);
  }
  function togglePaintMode() {
    finish(false);
    setPaintMode((value) => !value);
  }
  return { shown: preview ?? selected, paintMode, togglePaintMode, onPointerDown, onCellClick,
    allowKeyboardClick: () => { suppressClickUntil.current = 0; }, cancel: () => finish(false) };
}
