"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Restore window scroll position after a client-fetched page's data loads.
// Next's built-in scroll restoration fires before our useEffect fetch resolves,
// so on Back the list is still "Loading…" and the position is lost. This saves
// scrollY per pathname and re-applies it once `ready` flips true.
export function useScrollRestore(ready: boolean) {
  const pathname = usePathname();
  useEffect(() => {
    const key = `scroll:${pathname}`;
    const onScroll = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pathname]);
  useEffect(() => {
    if (!ready) return;
    const y = sessionStorage.getItem(`scroll:${pathname}`);
    if (y && Number(y) > 0) requestAnimationFrame(() => window.scrollTo(0, Number(y)));
  }, [ready, pathname]);
}
