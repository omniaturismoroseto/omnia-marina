"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";

// Le foto molto grandi vengono ridotte nel browser prima dell'invio: bastano per vedere bene ogni posto
// e restano leggere da caricare e da mostrare sul telefono.
const MAX_SIDE = 3200;

async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Il file scelto non è un'immagine leggibile.");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Il browser non riesce a elaborare l'immagine.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Il browser non riesce a elaborare l'immagine.");
  return blob;
}

export function PhotoUploader({ hasPhoto, placedCount }: { hasPhoto: boolean; placedCount: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send(method: "POST" | "DELETE", body?: Blob) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/pianta/immagine", { method, body, headers: body ? { "Content-Type": "image/jpeg" } : undefined });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string; positionsReset?: boolean } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.message ?? "Operazione non riuscita. Riprova.");
      setResult({
        ok: true,
        message:
          method === "DELETE"
            ? "Foto rimossa."
            : data.positionsReset
              ? "Foto caricata. L'inquadratura è cambiata: scala e posizioni dei posti sono da reimpostare."
              : "Foto caricata.",
      });
      router.refresh();
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Operazione non riuscita. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (hasPhoto && placedCount > 0 && !window.confirm("Se la nuova foto ha un'inquadratura diversa, le posizioni dei posti già disposti verranno azzerate. Continuare?")) return;
    try {
      await send("POST", await prepare(file));
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Operazione non riuscita. Riprova." });
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Foto aerea del porto"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn ${hasPhoto ? "btn-secondary" : "btn-primary"}`} disabled={busy} onClick={() => input.current?.click()}>
          <ImageUp size={16} aria-hidden="true" />
          {busy ? "Caricamento…" : hasPhoto ? "Sostituisci la foto" : "Carica la foto del porto"}
        </button>
        {hasPhoto && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Rimuovere la foto? Scala e posizioni dei posti sulla pianta andranno perse. La mappa tornerà allo schema.")) void send("DELETE");
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            Rimuovi
          </button>
        )}
      </div>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`mt-2 rounded-md px-3 py-2 text-sm ${result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
