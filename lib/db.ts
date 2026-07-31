// E7-1: Supabase 서버 전용 클라이언트 (service_role) — lazy singleton.
// ⚠️ 서버 코드(app/api/*) 전용 — 클라이언트 컴포넌트에서 import 금지.
//    service_role 키는 RLS를 통과하는 전권 키라 브라우저로 나가면 DB 전체가 열린다.
// 환경변수(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) 미설정 시 null 반환 —
// 호출부는 기존 globalThis 메모리 스텁으로 폴백한다(로컬 개발·.simtest 헤드리스).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getDb(): SupabaseClient | null {
  if (client !== undefined) return client;
  // 대시보드에서 REST 엔드포인트(…/rest/v1)를 통째로 복사하는 실수 방어 — 기본 URL만 사용
  const url = process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return client;
}
