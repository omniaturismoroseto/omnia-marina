"use client";

import { useEffect, useState } from "react";
import { X } from "@/components/icons";

const KEY = "omnia-avviso-samsung-scuro";

/**
 * Samsung Internet, con il telefono in tema scuro, scurisce da sé le pagine con un suo filtro (colori spenti, mappa e foto grigie)
 * e il sito non può spegnerlo: «color-scheme» e il tema scuro dichiarato non bastano (vedi layout.tsx e globals.css). Qui, solo su
 * Samsung Internet in tema scuro, si spiega come lasciare all'app i suoi colori; «Ho capito» non lo mostra più su questo telefono.
 */
export function SamsungDarkNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const samsung = /SamsungBrowser/i.test(navigator.userAgent);
    const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {
      // Memoria del browser non disponibile: l'avviso si mostra di nuovo.
    }
    if (samsung && dark && !dismissed) {
      const timer = window.setTimeout(() => setShow(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  if (!show) return null;
  function close() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Niente: si chiude solo per questa volta.
    }
    setShow(false);
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[60] px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] no-print" role="dialog" aria-label="Colori scuri su Samsung Internet">
      <div className="mx-auto max-w-lg rounded-lg border border-line bg-card p-4 text-sm text-ink shadow-2xl">
        <div className="flex items-start gap-3">
          <p className="font-semibold">L&apos;app ti sembra scura o spenta?</p>
          <button type="button" className="btn btn-ghost btn-sm -mt-1 ml-auto" onClick={close} aria-label="Chiudi">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1 text-muted">
          È Samsung Internet che, con il telefono in tema scuro, scurisce le pagine da solo. Per vedere l&apos;app con i suoi colori:
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            apri <b>Samsung Internet</b> e tocca il menu <b>≡</b> in basso a destra;
          </li>
          <li>
            tocca <b>Modalità scura</b> per spegnerla (vale solo per il browser: il telefono può restare scuro).
          </li>
        </ol>
        <p className="mt-2 text-muted">
          Se vuoi tenere il browser scuro: menu ≡ → <b>Impostazioni</b> → <b>Laboratori</b> → attiva <b>Usa il tema scuro dei siti web</b>: così
          il browser lascia all&apos;app i suoi colori. Poi chiudi e riapri l&apos;app.
        </p>
        <button type="button" className="btn btn-primary btn-sm mt-3" onClick={close}>
          Ho capito
        </button>
      </div>
    </div>
  );
}
