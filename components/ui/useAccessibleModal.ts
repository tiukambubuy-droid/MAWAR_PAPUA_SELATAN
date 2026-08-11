"use client";

import { useEffect, type RefObject } from "react";

let pendingRestoreFrame: number | null = null;

export function useAccessibleModal(onClose: () => void, dialogRef?: RefObject<HTMLElement | null>, fallbackRef?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (pendingRestoreFrame !== null) {
      window.cancelAnimationFrame(pendingRestoreFrame);
      pendingRestoreFrame = null;
    }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = fallbackRef?.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => dialogRef?.current?.focus());
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      pendingRestoreFrame = window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger?.focus();
        else fallback?.focus();
        pendingRestoreFrame = null;
      });
    };
  }, [dialogRef, fallbackRef, onClose]);
}
