export type Signal = 'green' | 'yellow' | 'red' | 'gray';

export type CheckInMethod = 'gps' | 'ocr' | 'manual';

export interface Place {
  id: number;
  kakao_place_id: string | null;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  has_outlet: boolean | null;
  has_wifi: boolean | null;
  is_quiet: boolean | null;
  cached_signal: Signal | null;
  cached_median_duration: number | null;
  cached_checkin_count: number | null;
  cached_updated_at: string | null;
  is_closed: boolean;
}

export interface CheckIn {
  id: number;
  user_id: number;
  place_id: number;
  method: CheckInMethod;
  signal: Exclude<Signal, 'gray'>;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  text_review: string | null;
  is_hidden: boolean;
  created_at: string;
}

export interface User {
  id: number;
  kakao_id: string;
  nickname: string;
  badge_level: number;
  trust_modifier: number;
}
