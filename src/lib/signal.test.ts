/**
 * computeSignalFromRows 단위 테스트.
 * 실행: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignalFromRows } from './signal';

type Row = Parameters<typeof computeSignalFromRows>[0][number];

function row(overrides: Partial<Row> = {}): Row {
  return {
    user_id: 1,
    method: 'gps',
    signal: 'green',
    duration_min: 120,
    created_at: new Date().toISOString(),
    user_trust_modifier: 1.0,
    ...overrides,
  };
}

test('빈 배열이면 gray, count=0', () => {
  const r = computeSignalFromRows([]);
  assert.equal(r.signal, 'gray');
  assert.equal(r.count, 0);
  assert.equal(r.median_min, null);
});

test('green 1건(120m, gps) → green, count=1, median=120', () => {
  const r = computeSignalFromRows([row({ signal: 'green', duration_min: 120 })]);
  assert.equal(r.signal, 'green');
  assert.equal(r.count, 1);
  assert.equal(r.median_min, 120);
});

test('표본 부족(<3건) 이면 median 룰 미적용 → yellow (예: GPS 즉시 인증 1건만 있는 경우)', () => {
  // GPS 즉시 인증 흐름은 duration≈0 이라, 1~2건만으로 비추 처리하지 않음.
  // 신호 자체는 green 이지만 데이터 부족으로 보수적으로 yellow.
  const r = computeSignalFromRows([row({ signal: 'green', duration_min: 30 })]);
  assert.equal(r.signal, 'yellow');
});

test('green 1건 median 60 → yellow (90 미만)', () => {
  const r = computeSignalFromRows([row({ signal: 'green', duration_min: 60 })]);
  assert.equal(r.signal, 'yellow');
});

test('red 비율 40% 이상이면 red (median 도 45 미만)', () => {
  // 3 green 120m + 3 red 30m → greenRatio 0.5, redRatio 0.5, median 30
  // green 분기 (median≥90 AND greenRatio≥0.6) 둘 다 실패 → red 분기
  const rows = [
    row({ user_id: 1, signal: 'green', duration_min: 120 }),
    row({ user_id: 2, signal: 'green', duration_min: 120 }),
    row({ user_id: 3, signal: 'green', duration_min: 120 }),
    row({ user_id: 4, signal: 'red', duration_min: 30 }),
    row({ user_id: 5, signal: 'red', duration_min: 30 }),
    row({ user_id: 6, signal: 'red', duration_min: 30 }),
  ];
  const r = computeSignalFromRows(rows);
  assert.equal(r.signal, 'red');
});

test('같은 user_id 는 가장 최근 1건만 카운트', () => {
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const recent = new Date().toISOString();
  const rows = [
    row({ user_id: 1, signal: 'red', duration_min: 30, created_at: old }),
    row({ user_id: 1, signal: 'green', duration_min: 120, created_at: recent }),
  ];
  const r = computeSignalFromRows(rows);
  assert.equal(r.count, 1, 'dedup 후 1건');
  assert.equal(r.signal, 'green', '최신 green 만 반영');
});

test('manual 가중치는 0.3 — gps 1건 + manual 1건이 충돌하면 gps 우세', () => {
  // gps green 120m + manual red 30m
  // 가중치: gps = 1.0, manual = 0.3
  // greenRatio = 1.0 / 1.3 ≈ 0.77, redRatio = 0.3 / 1.3 ≈ 0.23
  // weighted median: gps weight 1.0 → 120, manual 0.3 → 30
  //   sorted by value: [(30, 0.3), (120, 1.0)] cumulative: 0.3, 1.3
  //   totalW/2 = 0.65 → 첫 누적 0.3 < 0.65, 두 번째 1.3 >= 0.65 → median = 120
  // → median 120 ≥ 90 AND greenRatio 0.77 ≥ 0.6 → green
  const rows = [
    row({ user_id: 1, method: 'gps', signal: 'green', duration_min: 120 }),
    row({ user_id: 2, method: 'manual', signal: 'red', duration_min: 30 }),
  ];
  const r = computeSignalFromRows(rows);
  assert.equal(r.signal, 'green');
});

test('user_trust_modifier 0 이면 그 표는 무시 (totalW 영향 없음)', () => {
  // 신뢰도 0 인 manual red 1건만 있으면 totalW = 0 → gray
  const r = computeSignalFromRows([
    row({ method: 'manual', signal: 'red', duration_min: 30, user_trust_modifier: 0 }),
  ]);
  assert.equal(r.signal, 'gray');
  assert.equal(r.count, 1, 'dedup count 는 가중치와 무관');
});

test('age decay — 60일 전 표는 가중치 절반', () => {
  // gps green 120 1건 (60일 전) vs gps red 30 1건 (오늘)
  //   60일전 가중치: 1.0 * 0.5 = 0.5, 오늘: 1.0 * 1.0 = 1.0
  //   greenRatio = 0.5/1.5 ≈ 0.33, redRatio = 1.0/1.5 ≈ 0.67
  //   weighted median: sorted [(30, 1.0), (120, 0.5)] cum 1.0, 1.5
  //     totalW/2 = 0.75 → 첫 1.0 ≥ 0.75 → median = 30
  //   → median 30 < 45 → red
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const r = computeSignalFromRows([
    row({ user_id: 1, signal: 'green', duration_min: 120, created_at: old }),
    row({ user_id: 2, signal: 'red', duration_min: 30 }),
  ]);
  assert.equal(r.signal, 'red');
});
