"use client";

import { useEffect } from "react";

// Il contenuto della guida arriva dopo la navigazione (Suspense): il browser ha già provato a scorrere
// all'ancora (#clienti…) quando la sezione non c'era. Si riprova appena le sezioni sono sulla pagina.
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
