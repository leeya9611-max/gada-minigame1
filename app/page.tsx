import Link from "next/link";

// 개발/미리보기용 랜딩. 실제 진입은 딥링크 → /game?token=... 로 이루어진다.
export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "#0e1526",
      }}
    >
      <Link
        href="/game"
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          maxHeight: "100%",
          aspectRatio: "16 / 9",
          backgroundImage: "url(/assets/intro.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        aria-label="야리끼리 대소동 게임 시작"
      />
    </main>
  );
}
