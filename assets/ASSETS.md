# 에셋 매니페스트

출처: Kenney (kenney.nl) 무료 팩. 라이선스 **CC0** — 상업적 사용·수정·재배포 자유, 출처표기 의무 없음(표기 권장). `LICENSE-kenney.txt` 참조.

게임 요소 ↔ 에셋 매핑은 아래 표 기준. 스타일은 Kenney 벡터 카툰 톤으로 통일했다(픽셀 확장팩·커서팩은 톤이 달라 제외).

## 캐릭터

| 게임 요소 | 폴더 | 소스 | 비고 |
|---|---|---|---|
| 김반장 (주인공/근로자) | `characters/gimbanjang/` | Platformer Characters – Player | idle/run1/run2/jump/fall/hurt/duck/cheer + tilesheet. **업로드한 파란 작업복+안전모 커스텀 스프라이트로 교체 예정**(이 세트는 임시 플레이스홀더) |
| 박소장 (빌런/현장소장) | `characters/parksojang/` | Platformer Characters – Soldier | idle/run1/run2/throw(=action1)/talk/win. 투척 모션은 `parksojang_throw.png` |

러닝 애니메이션은 run1↔run2 2프레임 교차. tilesheet로 프레임 자름도 가능.

## 아이템

| 게임 요소 | 파일 | 비고 |
|---|---|---|
| 안전모 코인 | `items/coin_gold.png` (+silver/bronze) | 임시. 실제 "안전모" 형태 코인은 커스텀 필요 |
| 퇴근길 부스터(무적) | `items/booster_star.png` | 임시(별). 부스터 전용 아이콘 커스텀 권장 |
| 예비 아이템 | `items/item_gem_yellow.png` | 필요 시 활용 |

## 장애물 / 타일 / 배경

| 게임 요소 | 위치 | 비고 |
|---|---|---|
| 시멘트 웅덩이·자재 더미 등 지면 장애물 | `obstacles/industrial/` | 산업 타일셋(스프라이트시트 `platformIndustrial_sheet.png`+`.xml`, 개별 타일 112장). XML의 프레임 좌표로 배럴/크레이트/파이프/철골 등 선택 |
| 현장 바닥 타일 | `tiles/` | Remastered Stone 세트(콘크리트/석재 느낌) |
| 배경 | `backgrounds/` | `colored_land.png`, `blue_land.png`(하늘). 원경 크레인/건물은 커스텀 추가 |

## HUD / UI

| 용도 | 위치 | 비고 |
|---|---|---|
| 인게임 HUD | `hud/` | 코인아이콘, 숫자 0~9, 하트(=티켓/라이프), 김반장 아바타, X |
| 버튼/패널 (기본) | `ui/blue/` | 시작·다시하기 등 주 버튼, 패널 |
| 버튼/패널 (강조·CTA) | `ui/yellow/` | 친구초대·광고시청 등 강조 액션 |

## 아직 커스텀이 필요한 에셋 (Kenney에 없음)

- 김반장 최종 스프라이트(업로드한 파란 작업복+노란 안전모 런사이클)
- 박소장 투척물: 결재 서류 뭉치 / 현장 도면 통 / 확성기
- 투척 경고 마크 '!' (기획서: 1~2초 선행 표시)
- 다방커피 아이템(상표권 회피 창작 디자인)
- 원경 배경: 타워크레인, 골조 건물, 버스 정류장(결승)
- 티어 배지: 초보 조공 / 기공 / 반장 / 야리끼리 마스터

## 원본 팩 (참고)

업로드된 zip 원본에는 더 많은 변형이 있다: 캐릭터 색상별(Beige/Blue/Green/Pink/Yellow), Adventurer/Female/Zombie, 토끼·로봇 등 Toon Characters, 산업 확장 픽셀타일, 커서팩, UI 6색상. 필요 시 원본에서 추가 반입.
