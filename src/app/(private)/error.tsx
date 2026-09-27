"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="login">
      <div className="panel login-card">
        <h1>Datele nu au putut fi încărcate</h1>
        <p>Verifică conexiunea și încearcă din nou.</p>
        <button className="button primary section-gap" onClick={reset}>
          Reîncearcă
        </button>
      </div>
    </div>
  );
}
