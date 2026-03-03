"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useInfiniteScroll(
  totalCount: number,
  pageSize = 10,
  resetKey = "",
) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Reset when filter changes
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [resetKey, pageSize]);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      sentinelRef.current = node;
      if (!node) return;
      if (visibleCount >= totalCount) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setVisibleCount((prev) => Math.min(prev + pageSize, totalCount));
          }
        },
        { rootMargin: "200px" },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [visibleCount, totalCount, pageSize],
  );

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

  return { visibleCount, sentinelRef: ref };
}
