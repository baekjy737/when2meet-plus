"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { dateRange, isValidDate, minToHHMM as time, pad } from "@/lib/slots";
import { dateInTimezone, isValidTimezone } from "@/lib/event-validation";
import type { EventMode } from "@/lib/types";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const COMMON_ZONES = [
  ["Asia/Seoul", "서울"], ["Asia/Tokyo", "도쿄"], ["America/Los_Angeles", "로스앤젤레스"],
  ["America/New_York", "뉴욕"], ["Europe/London", "런던"], ["UTC", "협정 세계시"],
] as const;

export default function CreateForm() {
  const router = useRouter();
  // Browser-specific defaults are initialized after hydration.
  const [ready, setReady] = useState(false);
  const [timezone, setTimezone] = useState("Asia/Seoul");
  const [now, setNow] = useState(0);
  const [mode, setMode] = useState<EventMode>("time");
  const [name, setName] = useState("");
  const [month, setMonth] = useState({ y: 2000, m: 0 });
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [start, setStart] = useState(9 * 60);
  const [end, setEnd] = useState(21 * 60);
  const [slot, setSlot] = useState(30);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zone = isValidTimezone(browserZone) ? browserZone : "Asia/Seoul";
    const timestamp = Date.now();
    const today = dateInTimezone(zone, timestamp);
    setTimezone(zone);
    setNow(timestamp);
    setMonth({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 });
    setRangeStart(today);
    setRangeEnd(today);
    setReady(true);
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  const todayIso = dateInTimezone(timezone, now);
  const otherZones = useMemo(() => {
    const common = new Set<string>(COMMON_ZONES.map(([zone]) => zone));
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([timezone, ...zones])].filter((zone) => !common.has(zone)).sort();
  }, [timezone]);
  const rangeDates = useMemo(() => dateRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const rangeError = !isValidDate(rangeStart) || !isValidDate(rangeEnd)
    ? "시작일과 종료일을 선택하세요."
    : rangeStart < todayIso || rangeEnd < todayIso
      ? "선택한 기준 시간대에서 오늘 이전 날짜는 사용할 수 없습니다."
      : rangeEnd < rangeStart
        ? "종료일은 시작일과 같거나 늦어야 합니다."
        : rangeDates.length === 0 ? "날짜 범위는 최대 62일까지 선택할 수 있습니다." : "";
  const datesError = dates.size === 0 ? "날짜를 하나 이상 선택하세요."
    : [...dates].some((date) => date < todayIso) ? "오늘 이전으로 바뀐 선택 날짜를 해제해 주세요." : "";
  const startOptions = Array.from({ length: 1440 / slot }, (_, index) => index * slot);
  const endOptions = Array.from({ length: 1440 / slot }, (_, index) => (index + 1) * slot).filter((minutes) => minutes > start);
  const validStart = startOptions.includes(start);
  const validEnd = endOptions.includes(end);
  const timeError = !validStart || end % slot !== 0 ? "시작·종료 시각을 선택 간격에 맞춰 다시 고르세요."
    : !validEnd ? "종료 시각은 시작 시각보다 최소 한 칸 이상 늦어야 합니다." : "";
  const disabledReason = !ready ? "날짜 정보를 불러오는 중입니다." : !name.trim() ? "이벤트 이름을 입력하세요."
    : mode === "date" ? rangeError : datesError || timeError;

  const cells = useMemo(() => {
    const first = new Date(month.y, month.m, 1).getDay();
    const days = new Date(month.y, month.m + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => iso(month.y, month.m, i + 1))];
  }, [month]);
  const toggle = (date: string) => setDates((selected) => {
    const next = new Set(selected);
    if (next.has(date)) next.delete(date);
    else if (date >= todayIso && next.size < 62) next.add(date);
    return next;
  });
  const shift = (delta: number) => setMonth(({ y, m }) => {
    const next = new Date(y, m + delta, 1);
    return { y: next.getFullYear(), m: next.getMonth() };
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || disabledReason) return;
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name, mode, dates: mode === "date" ? rangeDates : [...dates],
          ...(mode === "time" ? { startMin: start, endMin: end, slotMinutes: slot } : {}), timezone,
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

  if (!ready) return <div className="card create" role="status">날짜 정보를 불러오는 중입니다…</div>;

  return (
    <form className="card create" onSubmit={submit}>
      <fieldset className="mode-choice" disabled={busy}>
        <legend>어떤 일정을 조율하나요?</legend>
        <div className="mode-options">
          <label className={`mode-option ${mode === "time" ? "on" : ""}`}>
            <input type="radio" name="mode" value="time" checked={mode === "time"} onChange={() => { setMode("time"); setError(""); }} />
            <span><strong>시간 조율</strong><small>가능한 시간을 선택해요</small></span>
          </label>
          <label className={`mode-option ${mode === "date" ? "on" : ""}`}>
            <input type="radio" name="mode" value="date" checked={mode === "date"} onChange={() => { setMode("date"); setError(""); }} />
            <span><strong>날짜 조율</strong><small>가능한 날짜를 선택해요</small></span>
          </label>
        </div>
      </fieldset>
      <label className="field">
        <span>이벤트 이름</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 학생회 정기회의" maxLength={100} required disabled={busy} />
      </label>
      <label className="field">
        <span>기준 시간대</span>
        <select value={timezone} onChange={(e) => { setTimezone(e.target.value); setNow(Date.now()); setError(""); }} aria-describedby="timezone-help" disabled={busy}>
          <optgroup label="자주 쓰는 시간대">
            {COMMON_ZONES.map(([zone, label]) => <option key={zone} value={zone}>{label} · {zone}</option>)}
          </optgroup>
          <optgroup label="다른 시간대">
            {otherZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </optgroup>
        </select>
      </label>
      <p id="timezone-help" className="muted small">
        {timezone} 기준 오늘은 {todayIso}입니다. 시간대를 바꿔도 입력한 날짜와 시각은 그대로 유지됩니다.
      </p>
      {mode === "date" ? (
        <fieldset className="date-range" disabled={busy}>
          <legend>날짜 범위</legend>
          <div className="row">
            <label className="field">
              <span>시작일</span>
              <input type="date" value={rangeStart} min={todayIso} onChange={(e) => setRangeStart(e.target.value)} required aria-describedby="range-help" aria-invalid={!!rangeError} />
            </label>
            <label className="field">
              <span>종료일</span>
              <input type="date" value={rangeEnd} min={rangeStart > todayIso ? rangeStart : todayIso} onChange={(e) => setRangeEnd(e.target.value)} required aria-describedby="range-help" aria-invalid={!!rangeError} />
            </label>
          </div>
          <p id="range-help" className={rangeError ? "error small" : "muted small"} aria-live="polite">
            {rangeError || `시작일과 종료일을 포함한 ${rangeDates.length}일 중 가능한 날짜를 받습니다. (최대 62일)`}
          </p>
        </fieldset>
      ) : (
        <>
          <div className="field">
            <span>날짜 선택 <small>({dates.size}일 / 최대 62일)</small></span>
            <div className="cal">
              <div className="cal-head">
                <button type="button" onClick={() => shift(-1)} aria-label="이전 달" disabled={busy}>‹</button>
                <strong>{month.y}년 {month.m + 1}월</strong>
                <button type="button" onClick={() => shift(1)} aria-label="다음 달" disabled={busy}>›</button>
              </div>
              <div className="cal-grid">
                {WEEK.map((weekday) => <div key={weekday} className="cal-wd">{weekday}</div>)}
                {cells.map((date, index) => date ? (
                  <button type="button" key={date} onClick={() => toggle(date)}
                    disabled={busy || (!dates.has(date) && (date < todayIso || dates.size >= 62))}
                    className={`cal-day ${dates.has(date) ? "on" : ""} ${date < todayIso ? "past" : ""}`}
                    aria-label={`${date} ${dates.has(date) ? "선택 해제" : "선택"}`} aria-pressed={dates.has(date)}
                  >{Number(date.slice(8))}</button>
                ) : <div key={`x${index}`} />)}
              </div>
            </div>
            {datesError && dates.size > 0 && <p className="error small" role="status">{datesError}</p>}
          </div>
          <fieldset className="date-range" disabled={busy}>
            <legend>응답받을 시간 범위</legend>
            <div className="row">
              <label className="field">
                <span>시작 시각</span>
                <select value={start} onChange={(e) => setStart(Number(e.target.value))} aria-invalid={!validStart} aria-describedby="time-help">
                  {!validStart && <option value={start} disabled>{time(start)} (다시 선택)</option>}
                  {startOptions.map((minutes) => <option key={minutes} value={minutes}>{time(minutes)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>종료 시각</span>
                <select value={end} onChange={(e) => setEnd(Number(e.target.value))} aria-invalid={!validEnd} aria-describedby="time-help">
                  {!validEnd && <option value={end} disabled>{time(end)} (다시 선택)</option>}
                  {endOptions.map((minutes) => <option key={minutes} value={minutes}>{time(minutes)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>선택 간격</span>
                <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
                  <option value={15}>15분</option><option value={30}>30분</option><option value={60}>1시간</option>
                </select>
              </label>
            </div>
            <p id="time-help" className={timeError ? "error small" : "muted small"} aria-live="polite">
              {timeError || `${timezone} 기준 ${time(start)}–${time(end)} 중 가능한 시간을 ${slot}분 간격으로 받습니다.`}
            </p>
          </fieldset>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {disabledReason && <p className="muted small" id="create-help" aria-live="polite">{disabledReason}</p>}
      <button className="primary" disabled={busy || !!disabledReason} aria-describedby={disabledReason ? "create-help" : undefined}>
        {busy ? "만드는 중…" : "이벤트 만들기"}
      </button>
    </form>
  );
}
