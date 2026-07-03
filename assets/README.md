# assets

현재 게임 그래픽은 캔버스 벡터 렌더링(도형 기반)으로 처리한다. 스프라이트 도입 시 아래 규칙을 따른다.

- `raw/` — 다운로드한 Kenney(CC0) 등 **원본** 에셋 무수정 보관
- `characters/` — 김반장/박소장 색상 적용 등 **커스텀 편집본**
- `obstacles/` — 시멘트 웅덩이, 자재 더미, 서류뭉치
- `items/` — 다방커피, 퇴근길 부스터
- `ui/` — 경고 마크, 랭킹 아이콘, 티어 배지

## 현재 반입 상태 (2026-07)

Kenney 팩 큐레이션 완료. 상세 매핑은 `ASSETS.md` 참조.

- `raw/` — 원본 4팩 무수정: platformer-characters, platformer-pack-remastered, platformer-pack-industrial, ui-pack
- `characters/gimbanjang/` — 김반장 (Player 포즈, **임시 플레이스홀더**. 업로드된 파란 작업복+안전모 스프라이트로 교체 예정)
- `characters/parksojang/` — 박소장 (Soldier 포즈, `parksojang_throw.png`=투척 모션)
- `obstacles/industrial/` — 산업 타일셋(시트+XML+타일 112장) → 시멘트 웅덩이·자재 더미 소스
- `items/` — 안전모 코인(gold/silver/bronze), 부스터(별) 등 임시
- `tiles/` — 콘크리트 바닥, `backgrounds/` — 하늘
- `hud/` — 코인·숫자·하트(티켓)·아바타 / `ui/blue`·`ui/yellow` — 버튼/패널

참고: 원래 계획한 `ui/`(경고마크·랭킹아이콘·티어배지)와 별개로 HUD는 `hud/`, 버튼은 `ui/blue`·`ui/yellow`로 분리했다. 커스텀 필요분(투척물 3종, 경고 '!', 다방커피, 원경 크레인·정류장, 티어 배지)은 `ASSETS.md` 하단 참고.

## 라이선스

- Kenney 에셋: CC0 (표기 불필요) — 원본은 `raw/`에 그대로 보관. 전문은 `LICENSE-kenney.txt`.
- CC0 외 소스는 표기 조건 확인 후 사용하고, 출처를 이 파일에 기록한다.
