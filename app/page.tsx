import Link from "next/link";

// 개발/미리보기용 랜딩. 실제 진입은 딥링크 → /game?token=... 로 이루어진다.
export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        height: "100%",
        background: "linear-gradient(180deg, #1F2A44 0%, #0e1526 100%)",
        color: "#fff",
        textAlign: "center",
        padding: 24,
      }}
    >
      <h1 style={{ fontSize: 30, fontWeight: 800 }}>야리끼리 대소동</h1>
      <p style={{ color: "#9fb0cc", lineHeight: 1.6 }}>
        김반장의 현장 러닝 대소동.
        <br />
        원터치 2단 점프로 장애물을 피하고 안전모 코인을 모으세요.
      </p>
      <Link
        href="/game"
        style={{
          background: "#2E66F6",
          color: "#fff",
          padding: "14px 32px",
          borderRadius: 999,
          fontWeight: 700,
          textDecoration: "none",
          fontSize: 18,
        }}
      >
        게임 시작
      </Link>
    </main>
  );
}
