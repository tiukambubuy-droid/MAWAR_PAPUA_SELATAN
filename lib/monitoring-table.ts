export type SortDirection = "asc" | "desc";
export function stableSort<T>(items: readonly T[], value: (item: T) => string | number | null | undefined, direction: SortDirection) {
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const rawA = value(a.item), rawB = value(b.item), av = typeof rawA === "number" && !Number.isFinite(rawA) ? null : rawA, bv = typeof rawB === "number" && !Number.isFinite(rawB) ? null : rawB;
    if (av == null && bv == null) return a.index - b.index;
    if (av == null) return 1;
    if (bv == null) return -1;
    const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "id");
    return (direction === "asc" ? result : -result) || a.index - b.index;
  }).map(entry => entry.item);
}
export function dateSortValue(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number), maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= maxDay ? value : null;
}
export function paginate<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 1;
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const startIndex = items.length ? (page - 1) * safePageSize : 0, endIndex = Math.min(page * safePageSize, items.length);
  return { items: items.slice(startIndex, endIndex), page, pageCount, pageSize: safePageSize, start: items.length ? startIndex + 1 : 0, end: endIndex,
    hasPrevious: page > 1, hasNext: page < pageCount, total: items.length };
}
