"use client";

import { Children, isValidElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";

interface SectionProps {
  id: string;
  label: string;
  children: ReactNode;
}

/** Una parte della pagina Mappa del porto: compare nel menu in alto con la sua etichetta. */
export function PlanSection({ children }: SectionProps) {
  return <>{children}</>;
}

/**
 * Menu delle parti della pagina: si vede solo quella scelta. Le altre restano montate (solo nascoste), così passando da una
 * all'altra non si perdono le modifiche non salvate dell'editor. La parte scelta va nell'indirizzo (?parte=).
 */
export function PlanSections({ initial, children }: { initial: string; children: ReactNode }) {
  const sections = Children.toArray(children).filter((c): c is ReactElement<SectionProps> => isValidElement(c));
  const ids = sections.map((s) => s.props.id);
  const [current, setCurrent] = useState(ids.includes(initial) ? initial : ids[0]);

  function choose(id: string) {
    setCurrent(id);
    const url = new URL(window.location.href);
    url.searchParams.set("parte", id);
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  return (
    <>
      {sections.length > 1 && (
        <nav className="mb-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Parti della mappa del porto">
          {sections.map((s) => (
            <button
              key={s.props.id}
              type="button"
              aria-pressed={current === s.props.id}
              onClick={() => choose(s.props.id)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap ${
                current === s.props.id ? "border-sea bg-sea text-white" : "border-line bg-card text-ink hover:border-faint"
              }`}
            >
              {s.props.label}
            </button>
          ))}
        </nav>
      )}
      {sections.map((s) => (
        <div key={s.props.id} hidden={current !== s.props.id}>
          {s}
        </div>
      ))}
    </>
  );
}
