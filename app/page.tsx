import { redirect } from "next/navigation";

// 루트 진입 시 바로 게임 인트로(S1)로 — 중간 랜딩 제거(클릭 0회)
export default function Home() {
  redirect("/game");
}
