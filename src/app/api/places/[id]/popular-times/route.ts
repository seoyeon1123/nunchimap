import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/places/:id/popular-times?day=0..6
 * 지난 90일 check_ins 를 KST(Asia/Seoul) 기준 요일×시간으로 집계.
 * 요일 미지정 시 KST 기준 오늘 요일 사용 (0=일, 1=월, ... 6=토).
 *
 * 응답:
 *   { day_of_week: number, total: number, buckets: { hour: 0..23, count }[] }
 *   - buckets 는 항상 24개 (0 시간대도 count: 0 으로 채움)
 *
 * 인증 불필요.
 */
const LOOKBACK_DAYS = 90;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const dayParam = req.nextUrl.searchParams.get('day');
  const explicitDow = dayParam != null ? Number(dayParam) : NaN;
  const dow =
    Number.isInteger(explicitDow) && explicitDow >= 0 && explicitDow <= 6
      ? explicitDow
      : kstDayOfWeek(new Date());

  const supabase = getServiceClient();

  // RPC 가 없는 환경 대응 — 단순 select 후 자바스크립트로 집계.
  // 표본이 폭발적으로 커지면 SQL 함수로 옮기는 것이 좋음.
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 86_400_000,
  ).toISOString();

  const { data, error } = await supabase
    .from('check_ins')
    .select('created_at, started_at, method')
    .eq('place_id', id)
    .eq('is_hidden', false)
    .gte('created_at', since);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const buckets = new Array(24).fill(0) as number[];
  let total = 0;

  for (const row of data ?? []) {
    // GPS 체크인은 started_at 이 실제 카페에 있던 시각이라 더 정확.
    // manual/ocr 은 started_at 이 없거나 부정확하므로 created_at 사용.
    const ts =
      row.method === 'gps' && row.started_at ? row.started_at : row.created_at;
    const d = new Date(ts);
    const { dow: rowDow, hour } = kstParts(d);
    if (rowDow !== dow) continue;
    buckets[hour] += 1;
    total += 1;
  }

  return NextResponse.json({
    day_of_week: dow,
    total,
    buckets: buckets.map((count, hour) => ({ hour, count })),
  });
}

/** Date 를 KST 로 환산해 요일/시각 추출. JS Date 의 getUTCXxx 사용해 부동을 회피. */
function kstParts(d: Date): { dow: number; hour: number } {
  // KST = UTC+9
  const kstMs = d.getTime() + 9 * 3_600_000;
  const k = new Date(kstMs);
  return { dow: k.getUTCDay(), hour: k.getUTCHours() };
}

function kstDayOfWeek(d: Date): number {
  return kstParts(d).dow;
}
