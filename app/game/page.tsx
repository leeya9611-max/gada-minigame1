import Game from "./Game";

// 딥링크 진입점: /game?token=... 로 들어온다. 토큰 파싱은 클라이언트에서 수행.
export default function GamePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  return <Game token={searchParams.token} />;
}
