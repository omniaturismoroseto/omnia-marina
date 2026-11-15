"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";

// Il logo si prepara nel browser: via i margini trasparenti, lato lungo ridotto a una misura che basta per la stampa,
// salvato in PNG per conservare la trasparenza.
const MAX_SIDE = 1200;
const ALPHA_THRESHOLD = 8;

async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Il file scelto non è un'immagine leggibile (usa PNG o JPEG).");

  const source = document.createElement("canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const sctx = source.getContext("2d", { willReadFrequently: true });
  if (!sctx) throw new Error("Il browser non riesce a elaborare l'immagine.");
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Riquadro dei pixel visibili: molti file di logo hanno ampi margini trasparenti.
  const { data, width, height } = sctx.getImageData(0, 0, source.width, source.height);
  let top = height,
    left = width,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error("L'immagine è completamente trasparente.");
  const cropW = right - left + 1;
  const cropH = bottom - top + 1;

  const scale = Math.min(1, MAX_SIDE / Math.max(cropW, cropH));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cropW * scale));
  canvas.height = Math.max(1, Math.round(cropH * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Il browser non riesce a elaborare l'immagine.");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, left, top, cropW, cropH, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Il browser non riesce a elaborare l'immagine.");
  return blob;
}

export function LogoUploader({ hasLogo }: { hasLogo: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send(method: "POST" | "DELETE", body?: Blob) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/logo", { method, body, headers: body ? { "Content-Type": "image/png" } : undefined });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.message ?? "Operazione non riuscita. Riprova.");
      setResult({ ok: true, message: method === "DELETE" ? "Logo rimosso." : "Logo caricato: compare nel menu e nei documenti stampati." });
      router.refresh();
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "Operazione non riuscita. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
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
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Logo della società di gestione"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn ${hasLogo ? "btn-secondary" : "btn-primary"}`} disabled={busy} onClick={() => input.current?.click()}>
          <ImageUp size={16} aria-hidden="true" />
          {busy ? "Caricamento…" : hasLogo ? "Sostituisci il logo" : "Carica il logo"}
        </button>
        {hasLogo && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Rimuovere il logo? Menu e documenti stampati mostreranno solo il nome della società.")) void send("DELETE");
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
