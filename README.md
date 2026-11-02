# When2meet+

[When2meet](https://www.when2meet.com)에서 영감을 받은 그룹 일정 조율 웹앱입니다. When2meet 자체는 오픈소스가 아니며, 이 프로젝트는 독립적으로 새로 작성되었습니다.

**When2meet과 다른 점:** 이벤트를 만든 사람은 **최적 시간 순위**를 보고, 결과를 **엑셀(.xlsx) · CSV · JSON API**로 가져갈 수 있습니다.

## 기능

- 날짜와 시간대, 슬롯 단위(15/30/60분)를 골라 이벤트 생성 (회원가입 없음)
- **날짜 조율** 모드: 시작일~종료일 범위(양끝 포함, 최대 62일)를 정하고, 참가자는 가능한 날짜를 누르거나 드래그해 선택합니다. 이미 선택한 날짜에서 드래그를 시작하면 해당 구간을 해제합니다. 모바일 터치 드래그도 지원하며, 시간 입력 없이 날짜별 히트맵·최적 날짜 순위·내보내기를 제공합니다.
- 참가자: 이름(+선택 비밀번호)으로 입장하고, 드래그로 가능한 시간을 칠하면 자동 저장 (모바일 터치 지원)
- 그룹 히트맵, 칸에 마우스를 올리면 가능·불가 인원 표시, 10초마다 자동 갱신
- **관리자 페이지** (생성 시 발급되는 비밀 링크)
  - 최적 시간 순위: 회의 길이, 최소 인원, 필수 참석자 필터
  - 엑셀 내보내기: `최적 시간` / `시간대별`(히트맵 색상 포함) / `매트릭스`(참가자×슬롯 0/1) 시트
  - CSV (Excel에서 한글이 깨지지 않도록 BOM 포함), JSON

## 데이터 API

관리자 키를 Bearer 토큰으로 사용합니다.

```bash
curl -H "Authorization: Bearer <ADMIN_KEY>" \
  "https://<host>/api/events/<EVENT_ID>/export?format=json&duration=60&minPeople=3"
```

| 파라미터 | 설명 |
| --- | --- |
| `format` | `json`(기본) · `csv` · `xlsx` |
| `duration` | 회의 길이(분). 이 길이 동안 **계속** 가능한 사람만 집계합니다 |
| `minPeople` | 최소 가능 인원 |
| `limit` | 최적 시간 개수 (json 기본 20, xlsx 기본 50) |

JSON 응답에는 `event`, `participants`, `bestTimes`, `slots`(슬롯별 가능·불가 명단)가 들어 있습니다.

날짜 모드에서는 `event.mode`가 `date`이고, 참가자의 `slots`는 `2026-11-02` 같은 날짜 문자열입니다. `bestTimes`는 가능한 인원이 많은 날짜 순위이며, `duration`은 적용하지 않습니다. 날짜 모드 JSON에는 시각 필드를 넣지 않고, CSV·엑셀에서도 날짜와 가능·불가 인원만 표시합니다. 시간 모드는 기존 `YYYY-MM-DDTHH:MM` 슬롯 형식을 유지합니다.

이벤트 생성 API(`POST /api/events`)는 `mode: "time" | "date"`를 받으며, 생략하면 기존과 같이 시간 모드입니다. 날짜 모드는 `dates`에 선택 범위의 날짜 배열을 보내면 됩니다. 서버가 날짜 모드의 시간 관련 저장값을 자동 설정하므로 별도 시각 입력은 필요 없습니다.

## 실행

Node.js 22.13 이상이 필요합니다(내장 `node:sqlite` 사용).

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 분석 로직 단위 테스트
```

### 내 서버에 배포 (Docker)

```bash
docker compose up -d --build
```

SQLite 파일은 `./data/when2meet.db`에 저장됩니다. HTTPS는 앞단 리버스 프록시(Caddy, nginx 등)에서 처리하세요.

기존 SQLite DB를 그대로 사용할 수 있습니다. 첫 실행 때 이벤트 테이블에 `mode` 컬럼을 추가하고 기존 이벤트를 `time`으로 지정합니다. 기존 이벤트의 시간 범위와 참가자 응답은 변경하지 않습니다.

## 구조

```
src/
  app/                 Next.js App Router 페이지 + API 라우트
  components/          Grid(시간), DateGrid(날짜 드래그/히트맵), EventView, AdminView
  lib/analysis.ts      최적 시간 계산 (순수 함수, 클라이언트/서버 공용)
  lib/export.ts        xlsx / csv / json 생성
  lib/store/           저장소 인터페이스 + SQLite 구현
```

### Vercel + Firebase로 확장할 때

- `src/lib/store/index.ts`의 `EventStore` 인터페이스를 Firestore로 구현하고, `getStore()`에서 환경변수로 선택하게 하면 됩니다. 나머지 코드는 바꿀 필요가 없습니다.
- 관리자 비밀 링크 대신 로그인 기반 권한으로 바꾸려면 `isAdmin()`(`src/lib/server.ts`)을 교체하면 됩니다.

## 참고

- 시간은 이벤트를 만든 사람의 시간대(예: `Asia/Seoul`) 기준으로 표시되며, 참가자별 시간대 변환은 하지 않습니다.
- 그룹 가용 시간은 When2meet과 마찬가지로 링크를 가진 누구나 볼 수 있습니다. 내보내기와 API만 관리자 키가 필요합니다.

## License

MIT

## DB 관리 페이지 (운영자용)

`ops/dbadmin.mjs`는 의존성 없는 작은 관리 서버입니다. 이벤트 목록과 참가자 상세를 보고, 관리자 링크를 재발급하고, 이벤트나 응답을 삭제할 수 있습니다. 삭제하기 전에는 `VACUUM INTO`로 자동 백업합니다. 임의 SQL은 실행할 수 없습니다.

```bash
DATABASE_PATH=./data/when2meet.db PUBLIC_URL=https://your.host npm run dbadmin   # 127.0.0.1:3101
```

**인증이 없으므로 localhost에만 바인드합니다.** 원격에서 쓰려면 Tailscale `serve`(tailnet 전용) 같은 사설 경로로만 노출하세요. Funnel이나 공개 프록시로는 절대 노출하지 마세요.
