"use client";

import { useEffect } from "react";

/**
 * Cambia il titolo della scheda finché la pagina è aperta. Il browser lo usa come nome del file
 * quando si stampa "Salva come PDF", così il documento porta già numero e cliente.
 */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return null;
}
