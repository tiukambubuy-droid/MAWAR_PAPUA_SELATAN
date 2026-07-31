"use client";

export function DashboardLoading() {
  return (
    <main className="dashboard-loading" aria-busy="true" aria-live="polite">
      <section className="loading-brand">
        <span className="loading-mark" aria-hidden="true">♨</span>
        <div>
          <h1>Menyiapkan Dashboard Pemantauan</h1>
          <p>Memuat data wilayah, musim tanam, dan produksi...</p>
        </div>
      </section>
      <section className="dashboard-skeleton" aria-hidden="true">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-card skeleton-filter" />
        <div className="skeleton-kpis">
          {Array.from({ length: 5 }, (_, index) => <div className="skeleton-card" key={index} />)}
        </div>
        <div className="skeleton-primary">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
        <div className="skeleton-secondary">
          {Array.from({ length: 4 }, (_, index) => <div className="skeleton-card" key={index} />)}
        </div>
      </section>
    </main>
  );
}
