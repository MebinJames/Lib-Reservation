"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Holds a floor plan that is wider than a phone screen.
 *
 * The plan is wide enough that it scrolls sideways on a phone, and because the
 * rooms are numbered right to left, opening at the left edge hides the fan's
 * centre. So it opens centred instead, until the person scrolls it themselves.
 */
export default function PlanScroller({
  children,
  innerProps,
}: {
  children: ReactNode;
  /** passed to the plan's own wrapper, e.g. the editor's pointer handlers */
  innerProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Once the person has scrolled, stop re-centring on resize.
  const touched = useRef(false);
  const lastSet = useRef(0);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });
  const [hint, setHint] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 1;
    if (overflow && !touched.current) {
      lastSet.current = Math.round(max / 2);
      el.scrollLeft = lastSet.current;
    }
    setEdges({
      overflow,
      left: el.scrollLeft > 2,
      right: el.scrollLeft < max - 2,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div>
      <div className="relative">
        <div
          ref={ref}
          className="overflow-x-auto"
          onScroll={() => {
            const el = ref.current;
            if (el && Math.abs(el.scrollLeft - lastSet.current) > 2) {
              touched.current = true;
              setHint(false);
            }
            measure();
          }}
        >
          <div className="min-w-[760px]" {...innerProps}>
            {children}
          </div>
        </div>
        {edges.left && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-[color:var(--panel)] to-transparent"
          />
        )}
        {edges.right && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-[color:var(--panel)] to-transparent"
          />
        )}
      </div>
      {edges.overflow && hint && (
        <p className="pt-2 text-center text-xs text-[color:var(--muted)]">
          Swipe to see the whole room
        </p>
      )}
    </div>
  );
}
