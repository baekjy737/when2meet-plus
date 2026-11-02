"use client";

import { useState } from "react";
import Grid from "./Grid";
import DateGrid from "./DateGrid";
import SlotDetail from "./SlotDetail";
import { usePeople } from "./usePeople";
import { useParticipantResponse } from "./useParticipantResponse";
import type { PublicEvent, PublicParticipant } from "@/lib/types";

const similarName = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

export default function EventView({ event, initialPeople }: { event: PublicEvent; initialPeople: PublicParticipant[] }) {
  const dateOnly = event.mode === "date";
  const { people, setPeople, counts } = usePeople(event.id, initialPeople);
  const response = useParticipantResponse(event.id, setPeople);
  const { session, mine, restoring, busy, saving, status, issue, privateLink } = response;
  const [hover, setHover] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const similar = name.trim() ? people.filter((p) => p.name !== name.trim() && similarName(p.name) === similarName(name)) : [];

  async function copyLink() {
    try { await navigator.clipboard.writeText(privateLink); setCopyStatus("복사됨"); }
    catch { setCopyStatus("아래 링크를 직접 선택해 복사해 주세요."); }
  }

  return (
    <div className="event">
      <div className="event-head">
        <h1>{event.name}</h1>
        <p className="muted">응답 {people.length}명 · {dateOnly ? "날짜 조율" : `${event.timezone} 기준`} · 링크를 공유해 가능한 {dateOnly ? "날짜를" : "시간을"} 받으세요</p>
      </div>
      <div className="panels">
        <section className="panel">
          {restoring ? <p role="status">내 응답을 불러오는 중…</p> : session ? (
            <>
              <div className="panel-head">
                <h2>{session.name}님의 가능한 {dateOnly ? "날짜" : "시간"}</h2>
                <button className="link" disabled={saving || busy} onClick={response.signOut}>로그아웃</button>
              </div>
              <p className="muted small">선택하면 자동 저장됩니다. 이 브라우저로 다시 접속하면 계속 수정할 수 있습니다.</p>
              {issue && <div className="response-notice" role="alert">
                <p>현재 선택을 임시로 유지하고 있습니다. 최신 응답을 불러오면 저장하지 못한 선택은 사라집니다.</p>
                <div className="response-actions">
                  {issue === "network" && <button disabled={busy} onClick={() => response.save(mine, true)}>다시 저장</button>}
                  <button disabled={busy} onClick={response.reload}>최신 응답 불러오기</button>
                </div>
              </div>}
              <fieldset className="response-grid" disabled={busy} aria-busy={busy}>
              {dateOnly ? <>
                <p className="muted small">{event.dates.length}일 중 {mine.size}일 선택</p>
                <DateGrid event={event} selected={mine} onChange={response.save} status={status} />
              </> : <Grid event={event} selected={mine} onChange={response.save} status={status} />}
              </fieldset>
              <div className="response-actions">
                <button disabled={busy || !!issue || mine.size === 0} onClick={() => {
                  if (confirm("이 이벤트의 모든 날짜·시간 선택을 지울까요? 다른 날짜 페이지의 선택도 지워지며 참가자 목록에는 남습니다.")) response.save(new Set());
                }}>선택 전체 해제</button>
                <button className="danger-button" disabled={busy || saving} onClick={response.withdraw}>참여 취소</button>
              </div>
              <div className="response-access">
                <h3>다른 기기에서 내 응답 수정</h3>
                <p className="muted small">등록한 비밀번호 또는 개인 수정 링크로 접속할 수 있습니다. 이름만으로는 기존 응답을 열 수 없습니다.</p>
                <button disabled={busy} onClick={response.createLink}>{privateLink ? "수정 링크 새로 발급" : "개인 수정 링크 발급"}</button>
                <p className="muted small">새로 발급하면 이전 개인 수정 링크는 사용할 수 없습니다.</p>
                {privateLink && <div className="private-link">
                  <label className="field"><span>개인 수정 링크</span><input readOnly value={privateLink} onFocus={(e) => e.target.select()} /></label>
                  <button onClick={copyLink}>수정 링크 복사</button>
                  <span role="status">{copyStatus}</span>
                  <p className="muted small">내 응답의 수정·참여 취소 권한이 포함되어 있습니다. 본인만 보관하세요.</p>
                </div>}
              </div>
            </>
          ) : (
            <form className="signin" onSubmit={(e) => { e.preventDefault(); void response.signIn(name, password); }}>
              <h2>내 {dateOnly ? "날짜" : "시간"} 입력하기</h2>
              <label className="field"><span>이름</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} required autoComplete="username" /></label>
              {similar.length > 0 && <p className="response-notice small">비슷한 이름이 이미 있어요: {similar.map((p) => p.name).join(", ")}. 본인의 기존 응답이라면 등록한 이름과 비밀번호 또는 개인 수정 링크로 접속하세요. 새 참가자는 구분되는 이름을 사용해 주세요.</p>}
              <label className="field"><span>비밀번호 <small>(선택 · 이 이벤트에서만 사용)</small></span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
              <p className="muted small">처음 참여할 때 비밀번호는 선택입니다. 설정하면 다른 기기에서도 이름과 비밀번호로 수정할 수 있습니다. 비밀번호 없이 참여하면 이 기기 또는 개인 수정 링크로 수정하세요.</p>
              {status && <p className="error" role="alert">{status}</p>}
              <button className="primary" disabled={busy || !name.trim()}>{busy ? "접속 중…" : "시작하기"}</button>
              <p className="muted small">기존 응답의 수정 수단을 잃었다면 이벤트 관리자에게 개인 수정 링크 재발급을 요청하세요.</p>
            </form>
          )}
        </section>
        <section className="panel">
          <h2>모두의 가능한 {dateOnly ? "날짜" : "시간"}</h2>
          <Legend total={people.length} />
          {dateOnly ? <DateGrid event={event} counts={counts} total={people.length} onHover={setHover} /> : <Grid event={event} counts={counts} total={people.length} onHover={setHover} />}
          <SlotDetail slot={hover} people={people} slotMinutes={event.slotMinutes} mode={event.mode} />
        </section>
      </div>
    </div>
  );
}

export function Legend({ total }: { total: number }) {
  return <div className="legend"><span>0/{total}</span><span className="bar" /><span>{total}/{total}</span></div>;
}
