"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="panel login-card">
        <div className="brand">
          <BrandMark />
          <div>
            Voxa
          </div>
        </div>
        <h1>Bine ai revenit.</h1>
        <p>Intră în spațiul de lucru VoxaTech.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(e.currentTarget);
            const { error } =
              await createSupabaseBrowserClient().auth.signInWithPassword({
                email: String(form.get("email")),
                password: String(form.get("password")),
              });
            if (error) {
              setError(
                "Email sau parolă incorectă. Contul trebuie să fie invitat de un administrator.",
              );
              setBusy(false);
            } else {
              router.push("/dashboard");
              router.refresh();
            }
          }}
        >
          <label className="field">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="nume@voxatech.ro"
              required
            />
          </label>
          <label className="field">
            Parolă
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <Button
            className="section-gap"
            style={{ width: "100%" }}
            disabled={busy}
          >
            {busy ? "Se verifică…" : "Intră în cont"}
            <ArrowRight size={17} />
          </Button>
        </form>
        <div className="login-footer">
          <LockKeyhole
            size={13}
            style={{ display: "inline", marginRight: 7 }}
          />
          Acces privat · doar pentru echipa VoxaTech
        </div>
      </div>
    </div>
  );
}
