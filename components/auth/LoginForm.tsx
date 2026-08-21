"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

const GENERIC_ERROR = "Username atau kata sandi tidak sesuai.";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password"), next: nextPath }),
      });
      const result = await response.json() as { ok?: boolean; redirect?: string; error?: string };
      if (!response.ok || !result.ok || !result.redirect) {
        setError(GENERIC_ERROR);
        return;
      }
      window.location.replace(result.redirect);
    } catch {
      setError("Layanan masuk belum dapat dihubungi. Silakan coba kembali.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-form-heading">
        <span>AKSES TERBATAS</span>
        <h1>Masuk ke MAWAR</h1>
        <p>Gunakan akun yang telah diberikan oleh administrator.</p>
      </div>
      {error && <p ref={alertRef} className="auth-error" role="alert" tabIndex={-1}>{error}</p>}
      <label className="auth-field" htmlFor="auth-username">
        <span>Username</span>
        <span className="auth-input-wrap"><UserRound size={18} aria-hidden="true" /><input id="auth-username" name="username" type="text" autoComplete="username" maxLength={128} required disabled={submitting} /></span>
      </label>
      <label className="auth-field" htmlFor="auth-password">
        <span>Kata sandi</span>
        <span className="auth-input-wrap"><LockKeyhole size={18} aria-hidden="true" /><input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" maxLength={256} required disabled={submitting} /><button type="button" className="auth-password-toggle" aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} onClick={() => setShowPassword(value => !value)} disabled={submitting}>{showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></span>
      </label>
      <button className="auth-submit" type="submit" disabled={submitting} aria-disabled={submitting}>{submitting ? <LoaderCircle className="auth-spinner" size={19} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}<span>{submitting ? "Memproses akses..." : "Masuk"}</span></button>
      <p className="auth-help">Mengalami kendala akses? Hubungi administrator sistem.</p>
    </form>
  );
}
