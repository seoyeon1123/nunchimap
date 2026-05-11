/**
 * Expo Push Service 발송 헬퍼.
 *  - Expo 가 호스팅하는 HTTPS API (https://exp.host/--/api/v2/push/send) 호출.
 *  - FCM/APNs 키 관리 없이 동작 (Expo 가 대신 라우팅).
 *  - DeviceNotRegistered 등 invalid 토큰은 응답을 통해 받아서 정리한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default';
  badge?: number;
  channelId?: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoSendResponse {
  data?: ExpoTicket[];
  errors?: { message: string }[];
}

/**
 * Expo 토큰 검증 — "ExponentPushToken[xxx]" 또는 "ExpoPushToken[xxx]" 형태만 통과.
 */
export function isExpoPushToken(t: string): boolean {
  return /^Expo(?:nent)?PushToken\[.+\]$/.test(t);
}

/**
 * 토큰별로 메시지를 보낸다.
 *  - 호출자는 토큰 목록과 공통 message payload 만 넘기면 됨.
 *  - 100개 단위로 chunk 해서 보낸다 (Expo 권장).
 *  - 만료된 토큰을 응답에서 발견하면 supabase 에서 삭제 (옵션).
 */
export async function sendExpoPush(
  tokens: string[],
  payload: Omit<ExpoPushMessage, 'to'>,
  options?: { supabase?: SupabaseClient; cleanInvalid?: boolean },
): Promise<{ sent: number; invalidRemoved: number }> {
  const valid = tokens.filter(isExpoPushToken);
  if (valid.length === 0) return { sent: 0, invalidRemoved: 0 };

  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  const invalidTokens: string[] = [];
  let sent = 0;

  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    const messages: ExpoPushMessage[] = chunk.map((to) => ({
      to,
      sound: 'default',
      ...payload,
    }));

    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
      });
    } catch (e) {
      console.error('[push] expo send network error', e);
      continue;
    }

    let body: ExpoSendResponse | null = null;
    try {
      body = (await res.json()) as ExpoSendResponse;
    } catch {
      console.error('[push] expo send non-json response', res.status);
      continue;
    }

    if (body.errors?.length) {
      console.error('[push] expo errors', body.errors);
    }

    const tickets = body.data ?? [];
    for (let j = 0; j < tickets.length; j++) {
      const ticket = tickets[j];
      if (ticket.status === 'ok') {
        sent++;
      } else if (
        ticket.details?.error === 'DeviceNotRegistered' ||
        ticket.message?.includes('not a registered push notification recipient')
      ) {
        invalidTokens.push(chunk[j]);
      }
    }
  }

  let invalidRemoved = 0;
  if (options?.cleanInvalid && options.supabase && invalidTokens.length > 0) {
    const { error } = await options.supabase
      .from('push_tokens')
      .delete()
      .in('token', invalidTokens);
    if (!error) invalidRemoved = invalidTokens.length;
  }

  return { sent, invalidRemoved };
}
