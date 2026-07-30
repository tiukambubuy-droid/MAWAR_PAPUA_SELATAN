"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DASHBOARD_FILTER_STORAGE_KEY,
  defaultDashboardFilters,
  dashboardHistoryMethod,
  normalizeDashboardFilterUrl,
  normalizeDashboardFilters,
  parseDashboardFilterParams,
  resolveInitialDashboardFilters,
} from "@/lib/dashboard-filters";
import type { DashboardFilterState } from "@/lib/dashboard-filters";
import { getDefaultSeasonSnapshot } from "@/lib/data-foundation";

type DashboardFilterContextValue = {
  filters: DashboardFilterState;
  hydrated: boolean;
  setSeason: (seasonId: string) => void;
  setCommodity: (commodityId: string) => void;
  setRegency: (regencyId: string) => void;
  setDistrict: (districtId: string | null) => void;
  setVillage: (villageId: string | null) => void;
  setSnapshot: (snapshotId: string | null) => void;
  resetFilters: () => void;
  applyUrlFilters: (params: URLSearchParams) => void;
  restoreSessionFilters: () => void;
};

const DashboardFilterContext = createContext<DashboardFilterContextValue | null>(null);

export function DashboardFilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState(defaultDashboardFilters);
  const [hydrated, setHydrated] = useState(false);
  const filtersRef = useRef(filters);

  const commitFilters = useCallback((next: DashboardFilterState, mode: "push" | "replace" | "popstate") => {
    const normalized = normalizeDashboardFilters(next);
    filtersRef.current = normalized;
    setFilters(normalized);
    if (mode !== "popstate") {
      const method = dashboardHistoryMethod(mode);
      const url = normalizeDashboardFilterUrl(normalized, window.location.pathname, window.location.hash);
      if (method && `${window.location.pathname}${window.location.search}${window.location.hash}` !== url) {
        window.history[method](null, "", url);
      }
    }
  }, []);

  const userUpdate = useCallback((update: (current: DashboardFilterState) => DashboardFilterState) => {
    commitFilters(update(filtersRef.current), "push");
  }, [commitFilters]);

  const restoreSessionFilters = useCallback(() => {
    try {
      const stored = sessionStorage.getItem(DASHBOARD_FILTER_STORAGE_KEY);
      if (stored) commitFilters(normalizeDashboardFilters(JSON.parse(stored)), "replace");
    } catch {
      sessionStorage.removeItem(DASHBOARD_FILTER_STORAGE_KEY);
    }
  }, [commitFilters]);

  const applyUrlFilters = useCallback((params: URLSearchParams) => {
    commitFilters(normalizeDashboardFilters(parseDashboardFilterParams(params), filtersRef.current), "replace");
  }, [commitFilters]);

  useEffect(() => {
    let restored = defaultDashboardFilters();
    try {
      const stored = sessionStorage.getItem(DASHBOARD_FILTER_STORAGE_KEY);
      if (stored) restored = normalizeDashboardFilters(JSON.parse(stored), restored);
    } catch {
      sessionStorage.removeItem(DASHBOARD_FILTER_STORAGE_KEY);
    }
    const params = new URLSearchParams(window.location.search);
    const initial = resolveInitialDashboardFilters(params, restored);
    queueMicrotask(() => {
      commitFilters(initial, "replace");
      setHydrated(true);
    });
    const handlePopState = () => {
      const next = resolveInitialDashboardFilters(new URLSearchParams(window.location.search), null);
      commitFilters(next, "popstate");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [commitFilters]);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem(DASHBOARD_FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters, hydrated]);

  const value = useMemo<DashboardFilterContextValue>(() => ({
    filters,
    hydrated,
    setSeason: (seasonId) => userUpdate((current) => normalizeDashboardFilters({
      ...current,
      seasonId,
      snapshotId: getDefaultSeasonSnapshot(seasonId)?.id ?? null,
    }, current)),
    setCommodity: (commodityId) => userUpdate((current) => normalizeDashboardFilters({ ...current, commodityId }, current)),
    setRegency: (regencyId) => userUpdate((current) => normalizeDashboardFilters({ ...current, regencyId, districtId: null, villageId: null }, current)),
    setDistrict: (districtId) => userUpdate((current) => normalizeDashboardFilters({ ...current, districtId, villageId: null }, current)),
    setVillage: (villageId) => userUpdate((current) => normalizeDashboardFilters({ ...current, villageId }, current)),
    setSnapshot: (snapshotId) => userUpdate((current) => normalizeDashboardFilters({ ...current, snapshotId }, current)),
    resetFilters: () => commitFilters(defaultDashboardFilters(), "push"),
    applyUrlFilters,
    restoreSessionFilters,
  }), [filters, hydrated, applyUrlFilters, restoreSessionFilters, userUpdate, commitFilters]);

  if (!hydrated) return <div className="app-loading" role="status">Memuat dashboard…</div>;
  return <DashboardFilterContext.Provider value={value}>{children}</DashboardFilterContext.Provider>;
}

export function useDashboardFilters() {
  const value = useContext(DashboardFilterContext);
  if (!value) throw new Error("useDashboardFilters must be used inside DashboardFilterProvider");
  return value;
}
