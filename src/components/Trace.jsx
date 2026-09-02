import React, { useState } from 'react';
import { cn } from '@site/src/lib/utils';

/**
 * <Trace> — an interactive, step-by-step walkthrough of a mechanism.
 *
 * The reader advances one step at a time and watches a state panel change.
 * Use it wherever the lesson is *what happens in what order*, rather than
 * *what is connected to what* (use a mermaid diagram for the latter).
 *
 *   <Trace title="A SELECT, traced" subtitle="…">
 *     <TraceStep
 *       title="Planner picks an index"
 *       state={{ 'Rows in play': '~40', 'Index': 'idx_user_created', 'Page reads': '3' }}
 *       changed={['Index', 'Page reads']}
 *       note="The estimate comes from statistics, not from the data.">
 *       Any markdown/JSX explaining the step.
 *     </TraceStep>
 *   </Trace>
 *
 * Props on TraceStep:
 *   title    — short label for the step (shown in the rail and the header)
 *   state    — object of key → value, rendered as the state panel
 *   changed  — array of state keys to emphasise as changed by THIS step
 *   note     — one-line takeaway shown under the body
 *   cost     — optional short string shown as a badge (e.g. "+38 page reads")
 */

export function TraceStep({ children }) {
  // Rendered only via <Trace>, which reads props off the element directly.
  return <>{children}</>;
}

export default function Trace({ title, subtitle, children }) {
  const steps = React.Children.toArray(children).filter(
    (child) => React.isValidElement(child) && child.props,
  );
  const [active, setActive] = useState(0);

  if (steps.length === 0) return null;

  const step = steps[active].props;
  const state = step.state || {};
  const changed = step.changed || [];
  const stateKeys = Object.keys(state);
  const atStart = active === 0;
  const atEnd = active === steps.length - 1;

  return (
    <div
      className={cn(
        'my-6 overflow-hidden rounded-xl border',
        'border-slate-200 bg-white',
        'dark:border-slate-700 dark:bg-slate-900',
      )}>
      {/* ---- header ---------------------------------------------------- */}
      {(title || subtitle) && (
        <div
          className={cn(
            'border-b px-4 py-3',
            'border-slate-200 bg-slate-50',
            'dark:border-slate-700 dark:bg-slate-800',
          )}>
          {title && (
            <div className="text-sm font-semibold tracking-wide text-slate-900 uppercase dark:text-slate-100">
              {title}
            </div>
          )}
          {subtitle && (
            <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
              {subtitle}
            </div>
          )}
        </div>
      )}

      {/* ---- step rail -------------------------------------------------- */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 border-b px-4 py-3',
          'border-slate-200 bg-slate-50/60',
          'dark:border-slate-700 dark:bg-slate-800/40',
        )}>
        {steps.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Step ${i + 1}: ${s.props.title || ''}`}
            aria-current={i === active ? 'step' : undefined}
            className={cn(
              'h-7 w-7 shrink-0 rounded-full border text-xs font-semibold transition-colors',
              'cursor-pointer',
              i === active
                ? 'border-transparent bg-amber-500 text-white'
                : i < active
                  ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
                  : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400',
            )}>
            {i + 1}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          step {active + 1} of {steps.length}
        </span>
      </div>

      {/* ---- body + state ----------------------------------------------- */}
      <div className="grid gap-0 md:grid-cols-[1fr_minmax(200px,280px)]">
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
              STEP {active + 1}
            </span>
            <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {step.title}
            </span>
            {step.cost && (
              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                {step.cost}
              </span>
            )}
          </div>

          <div className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300 [&_p:last-child]:mb-0">
            {step.children}
          </div>

          {step.note && (
            <div
              className={cn(
                'mt-3 border-l-2 py-1 pl-3 text-sm',
                'border-amber-400 text-slate-600',
                'dark:border-amber-500 dark:text-slate-400',
              )}>
              {step.note}
            </div>
          )}
        </div>

        {stateKeys.length > 0 && (
          <div
            className={cn(
              'border-t px-4 py-4 md:border-t-0 md:border-l',
              'border-slate-200 bg-slate-50',
              'dark:border-slate-700 dark:bg-slate-800/50',
            )}>
            <div className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
              State
            </div>
            <dl className="space-y-1.5">
              {stateKeys.map((k) => {
                const isChanged = changed.includes(k);
                return (
                  <div key={k} className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd
                      className={cn(
                        'text-right font-mono text-xs',
                        isChanged
                          ? 'rounded bg-amber-200 px-1 font-semibold text-amber-900 dark:bg-amber-500/30 dark:text-amber-100'
                          : 'text-slate-700 dark:text-slate-300',
                      )}>
                      {state[k]}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </div>

      {/* ---- controls ---------------------------------------------------- */}
      <div
        className={cn(
          'flex items-center gap-2 border-t px-4 py-3',
          'border-slate-200 bg-slate-50',
          'dark:border-slate-700 dark:bg-slate-800',
        )}>
        <button
          type="button"
          onClick={() => setActive((i) => Math.max(0, i - 1))}
          disabled={atStart}
          className={cn(
            'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
            'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200',
            atStart
              ? 'cursor-not-allowed opacity-40'
              : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800',
          )}>
          ← Back
        </button>
        <button
          type="button"
          onClick={() => setActive((i) => Math.min(steps.length - 1, i + 1))}
          disabled={atEnd}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-colors',
            atEnd
              ? 'cursor-not-allowed bg-slate-400 opacity-50 dark:bg-slate-600'
              : 'cursor-pointer bg-amber-500 hover:bg-amber-600',
          )}>
          Next →
        </button>
        {active > 0 && (
          <button
            type="button"
            onClick={() => setActive(0)}
            className="ml-auto cursor-pointer text-sm text-slate-500 underline-offset-2 hover:underline dark:text-slate-400">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
