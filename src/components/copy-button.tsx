"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copia un testo negli appunti (per incollarlo in un messaggio). */
export function CopyButton({ text, label = "Copia", size = "sm" }: { text: string; label?: string; size?: "sm" | "lg" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-secondary btn-${size}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copia il testo:", text);
        }
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? "Copiato" : label}
    </button>
  );
}
