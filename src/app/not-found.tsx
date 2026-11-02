import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card">
      <h1>일정을 찾을 수 없어요</h1>
      <p>주소가 올바른지 확인해 주세요. 일정이 삭제되었거나 잘못된 링크일 수 있어요.</p>
      <Link href="/">홈으로 돌아가기</Link>
    </section>
  );
}
