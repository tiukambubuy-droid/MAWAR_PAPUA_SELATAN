"use client";

import { LogOut, LoaderCircle } from "lucide-react";
import { useState } from "react";

export function LogoutButton() {
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", redirect: "manual" });
      window.location.replace("/login");
    } catch {
      setSubmitting(false);
    }
  }

  return <button type="button" className="auth-logout" onClick={logout} disabled={submitting} aria-label={submitting ? "Sedang keluar dari MAWAR" : "Keluar dari MAWAR"}>{submitting ? <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" /> : <LogOut size={18} aria-hidden="true" />}<span>{submitting ? "Keluar..." : "Logout"}</span></button>;
}
