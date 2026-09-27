export default async function Page({
  params,
}: {
  params: Promise<{ status: string }>;
}) {
  const { status } = await params;
  return (
    <main className="public-wrap">
      <div className="panel demo-player">
        <h1>
          {status === "success"
            ? "Mulțumim pentru încredere."
            : "Plata nu a fost finalizată."}
        </h1>
        <p className="muted section-gap">
          {status === "success"
            ? "După confirmarea plății, echipa VoxaTech îți va trimite formularul de configurare."
            : "Poți reveni la linkul de plată când ești pregătit."}
        </p>
      </div>
    </main>
  );
}
