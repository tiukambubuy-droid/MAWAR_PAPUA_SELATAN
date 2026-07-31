export function mawarReportSlug(kind: "produksi" | "musim-tanam" | "peta-lahan", scope: string, season?: string) {
  const suffix = [scope, season]
    .filter(Boolean)
    .join("-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `mawar-papua-selatan-${kind}-${suffix}`;
}

export function printWithMawarTitle(slug: string, cleanup?: () => void) {
  const previousTitle = document.title;
  document.title = slug;
  const restore = () => {
    document.title = previousTitle;
    cleanup?.();
  };
  window.addEventListener("afterprint", restore, { once: true });
  window.print();
  window.setTimeout(restore, 1000);
}
