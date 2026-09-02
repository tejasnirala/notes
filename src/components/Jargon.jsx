import React from 'react';
import { cn } from '@site/src/lib/utils';

/**
 * <Jargon> — the bridge between plain language and interview vocabulary.
 *
 * Layer 2 of the page format. Gives the beginner the idea in ordinary words,
 * and gives the experienced reader the exact term to say out loud.
 *
 *   <Jargon plain="Servers that copy everything the main one does"
 *           term="read replicas"
 *           also={['leader–follower replication', 'primary/secondary']}>
 *     Optional extra sentence of nuance.
 *   </Jargon>
 */
export default function Jargon({ plain, term, also = [], children }) {
  return (
    <div
      className={cn(
        'my-4 rounded-lg border-l-4 px-4 py-3',
        'border-sky-500 bg-sky-50',
        'dark:border-sky-400 dark:bg-sky-950/40',
      )}>
      <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          In plain words:
        </span>{' '}
        {plain}
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          The word to use:
        </span>{' '}
        <span className="font-mono font-semibold text-sky-700 dark:text-sky-300">
          {term}
        </span>
        {also.length > 0 && (
          <span className="text-slate-500 dark:text-slate-400">
            {' '}
            — also called {also.join(', ')}
          </span>
        )}
      </div>
      {children && (
        <div className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400 [&_p:last-child]:mb-0">
          {children}
        </div>
      )}
    </div>
  );
}
