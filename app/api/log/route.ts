// E6-3: 이벤트 로그 수집 스텁 — 서버 콘솔 기록만. 운영 전환 시 실제 수집기(자체 DB/GA)로 교체.
// 계약: POST { name: string, ...props, ts: number } → 204 (본문 없음, 실패도 게임에 무영향)
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("[EVENT]", JSON.stringify(body));
  } catch {
    /* 파싱 실패 무시 */
  }
  return new Response(null, { status: 204 });
}
