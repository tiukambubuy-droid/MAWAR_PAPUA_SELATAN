import Image from "next/image";
import { LoginForm } from "@/components/auth/LoginForm";
import { MawarCollaborationIllustration } from "@/components/auth/MawarCollaborationIllustration";
import { safeInternalRedirect } from "@/lib/auth/core";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const parameters = await searchParams;
  const nextPath = safeInternalRedirect(Array.isArray(parameters.next) ? parameters.next[0] : parameters.next);
  return (
    <main className="auth-page">
      <section className="auth-brand-panel" aria-labelledby="auth-brand-title">
        <div className="auth-brand-lockup"><Image src="/branding/logo-papua-selatan.png" alt="Lambang Pemerintah Provinsi Papua Selatan" width={52} height={65} priority /><div><strong>MAWAR</strong><span>Papua Selatan</span></div></div>
        <div className="auth-brand-copy"><p>MODEL AKSI WADAH KOLABORASI &amp; RESILIENSI</p><h2 id="auth-brand-title">Dashboard Model Aksi Wadah Kolaborasi<br />dan Resiliensi Papua Selatan</h2><span>Sistem informasi terpadu untuk mendukung pemantauan<br />dan pengambilan keputusan di Provinsi Papua Selatan.</span></div>
        <MawarCollaborationIllustration />
        <div className="auth-ready"><i aria-hidden="true" /><span>Sistem siap digunakan</span></div>
      </section>
      <section className="auth-form-panel"><div className="auth-form-shell"><LoginForm nextPath={nextPath} /><footer>© 2026 Pemerintah Provinsi Papua Selatan</footer></div></section>
    </main>
  );
}
