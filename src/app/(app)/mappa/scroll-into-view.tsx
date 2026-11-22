"use client";

import { useEffect, useRef } from "react";

// Sul telefono il riquadro del posto sta sotto la mappa: quando si tocca un posto lo si porta in vista.
// Sugli schermi grandi è sopra la mappa e la pagina non deve spostarsi.
export function ScrollIntoViewOnPhone() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) ref.current?.parentElement?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return <span ref={ref} hidden />;
}
