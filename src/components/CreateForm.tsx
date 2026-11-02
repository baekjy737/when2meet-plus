"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { dateRange, pad } from "@/lib/slots";
import type { EventMode } from "@/lib/types";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function CreateForm() {
  const router = useRouter();
  const today = new Date();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const [mode, setMode] = useState<EventMode>("time");
  const [name, setName] = useState("");
  const [month, setMonth] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState(todayIso);
  const [rangeEnd, setRangeEnd] = useState(todayIso);
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(21);
  const [slot, setSlot] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rangeDates = useMemo(() => dateRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const rangeError = !rangeStart || !rangeEnd
    ? "시작일과 종료일을 선택하세요."
    : rangeEnd < rangeStart
      ? "종료일은 시작일과 같거나 늦어야 합니다."
      : rangeDates.length === 0 ? "날짜 범위는 최대 62일까지 선택할 수 있습니다." : "";
  const canSubmit = !!name.trim() && (mode === "date" ? rangeDates.length > 0 : dates.size > 0 && end > start);

  const cells = useMemo(() => {
    const first = new Date(month.y, month.m, 1).getDay();
    const days = new Date(month.y, month.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => iso(month.y, month.m, i + 1))];
  }, [month]);

  const toggle = (d: string) => setDates((s) => {
    const n = new Set(s);
    n.has(d) ? n.delete(d) : n.add(d);
    return n;
  });

  const shift = (delta: number) => setMonth(({ y, m }) => {
    const t = new Date(y, m + delta, 1);
    return { y: t.getFullYear(), m: t.getMonth() };
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !canSubmit) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, mode, dates: mode === "date" ? rangeDates : [...dates],
          ...(mode === "time" ? { startMin: start * 60, endMin: end * 60, slotMinutes: slot } : {}),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "이벤트를 만들지 못했습니다.");
      try { localStorage.setItem(`admin:${data.id}`, data.adminKey); } catch {}
      router.push(`/e/${data.id}/admin#key=${data.adminKey}`);
    } catch {
      setError("연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const hours = Array.from({ length: 25 }, (_, h) => h);

  return (
    <form className="card create" onSubmit={submit}>
      <fieldset className="mode-choice" disabled={busy}>
        <legend>어떤 일정을 조율하나요?</legend>
        <div className="mode-options">
          <label className={`mode-option ${mode === "time" ? "on" : ""}`}>
            <input type="radio" name="mode" value="time" checked={mode === "time"} onChange={() => { setMode("time"); setError(""); }} />
            <span><strong>시간 조율</strong><small>가능한 시간대를 선택해요</small></span>
          </label>
          <label className={`mode-option ${mode === "date" ? "on" : ""}`}>
            <input type="radio" name="mode" value="date" checked={mode === "date"} onChange={() => { setMode("date"); setError(""); }} />
            <span><strong>날짜 조율</strong><small>가능한 날짜를 선택해요</small></span>
          </label>
        </div>
      </fieldset>

      <label className="field">
        <span>이벤트 이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 학생회 정기회의" maxLength={100} required />
      </label>

      {mode === "date" ? (
        <fieldset className="date-range">
          <legend>날짜 범위</legend>
          <div className="row">
            <label className="field">
              <span>시작일</span>
              <input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} required aria-describedby="range-help" />
            </label>
            <label className="field">
              <span>종료일</span>
              <input type="date" value={rangeEnd} min={rangeStart || undefined} onChange={(e) => setRangeEnd(e.target.value)} required aria-describedby="range-help" aria-invalid={!!rangeError} />
            </label>
          </div>
          <p id="range-help" className={rangeError ? "error small" : "muted small"} aria-live="polite">
            {rangeError || `시작일과 종료일을 포함한 ${rangeDates.length}일 중 가능한 날짜를 받습니다. (최대 62일)`}
          </p>
        </fieldset>
      ) : (
        <>
        <div className="field">
          <span>날짜 선택 <small>({dates.size}일)</small></span>
          <div className="cal">
            <div className="cal-head">
              <button type="button" onClick={() => shift(-1)} aria-label="이전 달">‹</button>
              <strong>{month.y}년 {month.m + 1}월</strong>
              <button type="button" onClick={() => shift(1)} aria-label="다음 달">›</button>
            </div>
            <div className="cal-grid">
              {WEEK.map((w) => <div key={w} className="cal-wd">{w}</div>)}
              {cells.map((d, i) => d ? (
                <button
                  type="button" key={d} onClick={() => toggle(d)}
                  className={`cal-day ${dates.has(d) ? "on" : ""} ${d < todayIso ? "past" : ""}`}
                  aria-label={`${d} 선택`} aria-pressed={dates.has(d)}
                >{Number(d.slice(8))}</button>
              ) : <div key={`x${i}`} />)}
            </div>
          </div>
        </div>

        <div className="row">
          <label className="field">
            <span>시작</span>
            <select value={start} onChange={(e) => setStart(Number(e.target.value))}>
              {hours.slice(0, 24).map((h) => <option key={h} value={h}>{pad(h)}:00</option>)}
            </select>
          </label>
          <label className="field">
            <span>종료</span>
            <select value={end} onChange={(e) => setEnd(Number(e.target.value))}>
              {hours.slice(1).map((h) => <option key={h} value={h}>{pad(h)}:00</option>)}
            </select>
          </label>
          <label className="field">
            <span>단위</span>
            <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
              <option value={15}>15분</option>
              <option value={30}>30분</option>
              <option value={60}>1시간</option>
            </select>
          </label>
        </div>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={busy || !canSubmit}>
        {busy ? "만드는 중…" : "이벤트 만들기"}
      </button>
    </form>
  );
}
