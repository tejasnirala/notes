import React from 'react';
import { cn } from '@site/src/lib/utils';

/**
 * <Depth> — an opt-in drawer for detail a beginner can skip and an
 * experienced reader came for. Layer 4 of the page format.
 *
 * Visually distinct from the rapid-fire <details> answers at the page foot.
 *
 *   <Depth title="Why the window doubles rather than ramps linearly">
 *     …derivation, kernel detail, the maths…
 *   </Depth>
 */
export default function Depth({ title, level = 'deeper', children }) {
  const label = level === 'expert' ? 'EXPERT DETAIL' : 'GO DEEPER';
  return (
    <details
      className={cn(
        'group my-4 overflow-hidden rounded-lg border',
        'border-violet-200 bg-violet-50/50',
        'dark:border-violet-800 dark:bg-violet-950/20',
      )}>
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 px-4 py-2.5',
          'hover:bg-violet-100/60 dark:hover:bg-violet-900/30',
        )}>
        <span className="text-xs font-bold tracking-wider text-violet-600 dark:text-violet-400">
          {label}
        </span>
        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {title}
        </span>
        <span className="ml-auto text-violet-500 transition-transform group-open:rotate-90 dark:text-violet-400">
          ▶
        </span>
      </summary>
      <div className="border-t border-violet-200 px-4 py-3 text-sm dark:border-violet-800 [&_p:last-child]:mb-0">
        {children}
      </div>
    </details>
  );
}
