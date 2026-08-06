// E8-보안: 게임 세션 메모리 폴백 스토어(무DB 환경 전용). DB 연결 시엔 game_sessions 테이블 사용.
// route 파일은 HTTP 핸들러 외 export가 금지되어 별도 모듈로 분리.
export interface SessionRec {
  userId: string;
  startedAt: number; // epoch ms
  consumed: boolean;
}
const g = globalThis as unknown as { __gameSessions?: Map<string, SessionRec> };
export const sessionStore: Map<string, SessionRec> = (g.__gameSessions ??= new Map());
