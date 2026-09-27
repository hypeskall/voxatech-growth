"use client";
import { useState } from "react";
import { Button } from "./ui/button";
export function OnboardingForm({
  token,
  complete,
}: {
  token: string;
  complete: boolean;
}) {
  const [done, setDone] = useState(complete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (done)
    return (
      <div className="panel demo-player">
        <h1>Mulțumim. Informațiile au fost salvate.</h1>
        <p className="muted section-gap">
          Echipa VoxaTech va pregăti următorii pași pentru configurarea
          recepționerului AI.
        </p>
      </div>
    );
  return (
    <form
      className="panel onboarding-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const body = Object.fromEntries(new FormData(e.currentTarget));
          const response = await fetch(`/api/onboarding/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!response.ok)
            throw new Error(
              "Verifică toate câmpurile. Linkul poate fi expirat.",
            );
          setDone(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Eroare la salvare.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {[
          ["clinic", "Nume clinică și adresă"],
          ["contact", "Persoană de contact și email"],
          ["services", "Servicii și specialități"],
          ["schedule", "Programul clinicii"],
          ["greeting", "Formula de întâmpinare preferată"],
          ["transfer", "Reguli de transfer către recepție"],
          ["appointments", "Reguli pentru programări"],
          ["calendar", "Calendar și informații de configurare (fără parole)"],
        ].map(([name, label]) => (
          <label className="field full" key={name}>
            {label}
            <textarea name={name} required maxLength={10000} rows={3} />
          </label>
        ))}
      </div>
      <p className="muted section-gap" style={{ fontSize: 13 }}>
        Nu introduce parole, chei de acces sau date personale ale pacienților.
      </p>
      {error && <p className="error-text">{error}</p>}
      <Button className="section-gap" disabled={busy}>
        {busy ? "Se salvează…" : "Trimite informațiile"}
      </Button>
    </form>
  );
}
