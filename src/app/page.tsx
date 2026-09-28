import CreateForm from "@/components/CreateForm";

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <h1>모두가 되는 시간, 한 번에.</h1>
        <p>날짜와 시간대를 고르고 링크를 공유하세요. 만든 사람은 결과를 엑셀·CSV·API로 가져갈 수 있습니다.</p>
      </section>
      <CreateForm />
    </div>
  );
}
