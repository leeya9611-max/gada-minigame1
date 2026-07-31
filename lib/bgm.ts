// E7-BGM: 루프 BGM 재생 — Suno 생성곡 "Hard Hat Dash"(마케터 제작) AAC 96k, 2:35 루프.
// ⚠️ Suno 상업 사용은 유료 플랜 생성분만 허용 — 이벤트 오픈 전 플랜 확인 필수.
// 대체 곡 필요 시 tools/bgm_gen.py(자체 칩튠, 라이선스 자유)로 재생성 가능.
// 단일 엘리먼트 루프, 탭 숨김 시 자동 일시정지·복귀 시 재개. 시작은 반드시
// 사용자 제스처(버튼 클릭) 컨텍스트에서 호출할 것(웹뷰 자동재생 정책).

let el: HTMLAudioElement | null = null;
let wanted = false; // 재개 의사 — 탭 복귀 시 이 값 기준으로 재개

function ensure(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!el) {
    el = new Audio("/sfx/bgm_main.m4a");
    el.loop = true;
    el.volume = 0.3; // 효과음보다 한 단 아래
    document.addEventListener("visibilitychange", () => {
      if (!el) return;
      if (document.hidden) el.pause();
      else if (wanted) el.play().catch(() => {});
    });
  }
  return el;
}

export function startBgm(): void {
  const a = ensure();
  if (!a) return;
  wanted = true;
  a.play().catch(() => {
    /* 자동재생 거부 등 — 다음 제스처에서 재시도됨 */
  });
}

export function pauseBgm(): void {
  wanted = false;
  ensure()?.pause();
}
