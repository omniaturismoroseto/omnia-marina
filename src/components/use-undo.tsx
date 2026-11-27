"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Redo2, Undo2 } from "@/components/icons";

/**
 * Indietro e Avanti (annulla e ripeti, come in Office) per un editor che tiene le modifiche in sospeso finché non si salva.
 * L'editor chiama `checkpoint()` prima di ogni modifica: si ricorda com'era (`read`). Più modifiche nello stesso istante (es. posti
 * e linea del pontile insieme) contano come una. Durante un trascinamento `pause(true)` evita un passo per ogni movimento: si fa
 * `checkpoint()` al primo movimento, poi `pause(true)`, e `pause(false)` al rilascio. `restore` rimette uno stato ricordato.
 * Ctrl+Z / Cmd+Z = Indietro, Ctrl+Y / Ctrl+Maiuscole+Z = Avanti, solo se l'editor (`scope`) è visibile e non si sta scrivendo in un campo.
 */
export function useUndoHistory<S>({
  read,
  restore,
  scope,
  limit = 100,
}: {
  read: () => S;
  restore: (state: S) => void;
  scope?: RefObject<HTMLElement | null>;
  limit?: number;
}) {
  const past = useRef<S[]>([]);
  const future = useRef<S[]>([]);
  const pending = useRef(false);
  const paused = useRef(false);
  const readRef = useRef(read);
  const restoreRef = useRef(restore);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  useEffect(() => {
    readRef.current = read;
    restoreRef.current = restore;
  });

  const sync = useCallback(() => setCounts({ undo: past.current.length, redo: future.current.length }), []);

  const checkpoint = useCallback(() => {
    if (paused.current || pending.current) return;
    pending.current = true;
    past.current.push(readRef.current());
    if (past.current.length > limit) past.current.shift();
    future.current = [];
    sync();
    void Promise.resolve().then(() => {
      pending.current = false;
    });
  }, [limit, sync]);

  const pause = useCallback((on: boolean) => {
    paused.current = on;
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev === undefined) return;
    future.current.push(readRef.current());
    restoreRef.current(prev);
    sync();
  }, [sync]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(readRef.current());
    restoreRef.current(next);
    sync();
  }, [sync]);

  /** Dimentica tutto (es. dopo che l'editor è ripartito da dati nuovi). */
  const clear = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      // Più editor nella stessa pagina (alcuni nascosti): risponde solo quello visibile.
      if (scope && (!scope.current || scope.current.offsetParent === null)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scope, undo, redo]);

  return { checkpoint, pause, undo, redo, clear, canUndo: counts.undo > 0, canRedo: counts.redo > 0 };
}

/** I due pulsanti «Indietro» e «Avanti», con il numero di passi disponibili nel suggerimento. */
export function UndoButtons({ history }: { history: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean } }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-white p-0.5" role="group" aria-label="Annulla e ripeti">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-ink hover:bg-line-soft disabled:opacity-40"
        onClick={history.undo}
        disabled={!history.canUndo}
        title="Annulla l'ultima modifica (Ctrl+Z)"
      >
        <Undo2 size={16} aria-hidden="true" /> Indietro
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-ink hover:bg-line-soft disabled:opacity-40"
        onClick={history.redo}
        disabled={!history.canRedo}
        title="Rifai la modifica annullata (Ctrl+Y)"
      >
        Avanti <Redo2 size={16} aria-hidden="true" />
      </button>
    </span>
  );
}
