"use client";

import { Printer } from "@/components/icons";

export function PrintButton({ label = "Stampa" }: { label?: string }) {
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      <Printer size={16} aria-hidden="true" />
      {label}
    </button>
  );
}
