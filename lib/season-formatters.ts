export const formatNumber = (value: number) =>
  Math.round(value).toLocaleString("id-ID");
export const formatPercent = (value: number) =>
  `${value.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
export const formatProductivity = (value: number) =>
  value.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const monthName = (date: Date, short = false) => date.toLocaleDateString("id-ID", { month: short ? "short" : "long" }).replace(".", "");
export const dateLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
export const formatIntegerId = formatNumber;
export const formatDecimalId = (value: number, digits = 2) => value.toLocaleString("id-ID", { maximumFractionDigits: digits });
export const formatPercentId = formatPercent;
export const formatAreaHa = (value: number) => `${formatNumber(value)} ha`;
export const formatTon = (value: number) => `${formatNumber(value)} ton`;
export const formatMonthYear = (period: string) => new Date(`${period}-01T00:00:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
