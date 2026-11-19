"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LoaderCircle, PencilRuler } from "lucide-react";
import { clearPlanDrawing, drawPlanFromPhoto } from "@/server/plan-actions";

/** Pulsanti del riquadro «Pianta disegnata»: ricava dalla foto la forma del porto, oppure la toglie. */
export function DrawingActions({ available, hasDrawing }: { available: boolean; hasDrawing: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setResult(null);
    start(async () => {
      const r = await action();
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <button type="button" className={`btn ${hasDrawing ? "btn-secondary" : "btn-primary"}`} disabled={!available || pending} onClick={() => run(drawPlanFromPhoto)}>
        {pending ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <PencilRuler size={16} aria-hidden="true" />}
        {pending ? "Disegno in corso…" : hasDrawing ? "Ridisegna dalla foto" : "Disegna la forma del porto"}
      </button>
      {hasDrawing && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(clearPlanDrawing)}>
          Togli la forma del porto
        </button>
      )}
      {pending && <p className="text-xs text-muted">Di solito ci vuole meno di un minuto.</p>}
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`max-w-sm rounded-md px-3 py-2 text-sm ${result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
