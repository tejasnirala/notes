import React from 'react';
import { cn } from '@site/src/lib/utils';

/**
 * <Plain> — the plain-English opener. Layer 1 of the page format.
 *
 * No jargon, an analogy, and why the reader should care. A beginner starts
 * here; an experienced reader skims it in fifteen seconds and moves on.
 *
 *   <Plain>
 *     Imagine a receptionist at a building with forty identical help desks…
 *   </Plain>
 */
export default function Plain({ title = 'Start here — in plain words', children }) {
  return (
    <div
      className={cn(
        'my-5 rounded-xl border p-4',
        'border-emerald-200 bg-emerald-50',
        'dark:border-emerald-800 dark:bg-emerald-950/30',
      )}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base" aria-hidden="true">
          🧭
        </span>
        <span className="text-xs font-bold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
          {title}
        </span>
      </div>
      <div
        className={cn(
          'text-[0.95rem] leading-relaxed text-slate-700 dark:text-slate-300',
          '[&_p:last-child]:mb-0',
        )}>
        {children}
      </div>
    </div>
  );
}
