import CreateForm from "@/components/CreateForm";

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <h1>모두가 되는 날과 시간, 한 번에.</h1>
        <p>시간대별로 조율하거나, 가능한 날짜만 간단히 받아보세요. 링크를 공유하고 결과를 엑셀·CSV·API로 가져갈 수 있습니다.</p>
      </section>
      <CreateForm />
    </div>
  );
}
