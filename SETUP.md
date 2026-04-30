# 눈치맵 셋업 가이드

W1 인프라 셋업을 위해 사용자가 직접 발급받아야 하는 키 목록과 실행 순서입니다.
모든 키 발급은 "당일~다음날" 안에 가능합니다.

## 0. 사전 준비

```bash
cd nunchimap
cp .env.example .env.local
# 이후 발급받은 키들을 .env.local 에 채워넣음
```

## 1. Supabase 프로젝트 생성 (5분)

1. https://supabase.com 가입
2. **New project** → 이름: `nunchimap`, 리전: **Northeast Asia (Seoul)** 권장
3. DB 비밀번호 설정 후 생성 (1~2분 대기)
4. 좌측 **Settings → API** 에서:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ 절대 클라이언트에 노출 금지)
5. **SQL Editor** 열고 `supabase/migrations/0001_init.sql` 내용 전체 복사·실행
   - PostGIS extension이 활성화되어야 함 (Database → Extensions에서 `postgis` 체크)

## 2. 카카오 디벨로퍼스 (10분)

1. https://developers.kakao.com 카카오 계정으로 로그인
2. **내 애플리케이션 → 애플리케이션 추가하기**
   - 앱 이름: `눈치맵`
   - 사업자명: 본인 이름 (사업자 등록 전이면 개인 이름)
3. 발급된 키 → `.env.local`
   - `JavaScript 키` → `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`
   - `REST API 키` → `KAKAO_REST_API_KEY` (지금 안 써도 추후 사용)
4. **앱 설정 → 플랫폼 → Web 플랫폼 등록**
   - 사이트 도메인: `http://localhost:3000` (개발용), 추후 배포 도메인 추가
5. **카카오 로그인 → 활성화 ON**
   - **Redirect URI**: `http://localhost:3000/api/auth/kakao/callback`
   - **동의 항목**: 닉네임 (필수), 프로필 사진 (선택)
   - REST API 키 = `KAKAO_OAUTH_CLIENT_ID`
   - **보안 → Client Secret** 발급 → `KAKAO_OAUTH_CLIENT_SECRET`

> 💡 **비즈 앱 전환 불필요**. 닉네임만 받으면 일반 앱으로 충분.

## 3. 공공데이터포털 LOCALDATA (선택 — Phase 2 사업자번호 보강용)

⚠️ **2025년부터 LOCALDATA 직접 API(`www.localdata.go.kr/.../openDataApi`)는 종료**됨.
현재 시드 파이프라인은 카카오 로컬 검색을 사용하므로 이 단계는 **MVP 단계에선 스킵 가능**.

추후 사업자등록번호 보강(`places.business_no`)이 필요해지면:
- https://www.localdata.go.kr/devcenter/dataDown.do 에서 휴게음식점 CSV 일괄 다운로드
- 또는 https://www.data.go.kr 의 신규 LOCALDATA 오픈API 신청

## 4. VWorld (선택 — LOCALDATA CSV 좌표 변환용)

⚠️ **카카오 로컬 검색이 좌표(WGS84)를 직접 반환**하므로 현재 시드엔 불필요.
LOCALDATA CSV 보강 단계에서 EPSG:5174→WGS84 변환할 때만 필요.

1. https://www.vworld.kr 가입
2. **오픈API → 인증키 발급**
3. 활용 API: **지오코더 2.0** 체크
4. 발급된 키 → `JUSO_API_KEY`

## 5. (선택) 네이버 클로바 OCR — Phase 5에서

W5에서 영수증 인증을 붙일 때 발급받으면 됩니다. 지금은 비워둬도 무방.

## 실행 순서

```bash
# 의존성 설치 (이미 됐으면 skip)
npm install

# 1) 시험 수집 (서울 1/16 영역 — ~수백 건)
npm run fetch:cafes -- --dry-run
# → data/cafes.dryrun.json 생성. 결과 확인 후 만족스러우면 다음.

# 2) 전체 수집 (서울 전역, ~10-30분, 수천~만 건)
#    호출이 막히면 KAKAO_INTERVAL_MS=300 등으로 천천히
npm run fetch:cafes
# → data/cafes.json
# 중간에 끊겨도 30초마다 자동 저장 → 다시 실행 시 이어받기

# 3) Supabase 적재 (카카오 결과는 좌표 포함이라 geocode 단계 불필요)
npm run load:cafes

# 4) 개발 서버 실행
npm run dev
# → http://localhost:3000
```

> 💡 카카오 로컬 API가 막혔을 때:
> - 콘솔(https://developers.kakao.com/console/app) → **제품 설정 → 카카오 로컬** 활성화 확인
> - **앱 설정 → 일반 → 트래픽** 에서 일일 한도 확인
> - 그래도 안 풀리면 `supabase/seeds/sample_cafes.sql` (있으면) 또는 수동 INSERT로 우선 검증

## 트러블슈팅

| 증상 | 원인/해결 |
|---|---|
| 지도 페이지에서 "지도 로드 실패" | `NEXT_PUBLIC_KAKAO_MAP_JS_KEY` 확인, 카카오 디벨로퍼스에서 `localhost:3000` 도메인 등록 확인 |
| LOCALDATA 응답이 비어있음 | 인증키 승인 상태 확인, `addrCode=11`(서울) 파라미터 확인 |
| VWorld 좌표 변환 실패율 높음 | 도로명주소 → 지번주소 폴백 작동. 그래도 실패하면 주소 정제 필요 |
| Supabase 적재 시 `extension postgis is not available` | Supabase 대시보드 → Database → Extensions 에서 `postgis` 활성화 |
