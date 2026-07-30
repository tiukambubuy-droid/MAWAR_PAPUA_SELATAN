export const formatNumber = (value: number) => value.toLocaleString("id-ID");
export const formatPercent = (value: number) => `${value.toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
export const monthName = (date: Date, short = false) => date.toLocaleDateString("id-ID", { month: short ? "short" : "long" }).replace(".", "");
export const dateLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
