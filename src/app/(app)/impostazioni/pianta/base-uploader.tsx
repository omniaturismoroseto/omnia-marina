"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "lucide-react";

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 8000;

// PNG e JPEG non troppo grandi partono così come sono (le linee restano nitide); gli altri formati
// o i file troppo pesanti si convertono in PNG nel browser.
async function prepare(file: File): Promise<Blob> {
  if ((file.type === "image/png" || file.type === "image/jpeg") && file.size <= MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Il file scelto non è un'immagine leggibile. Esporta la base in PNG.");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Il browser non riesce a elaborare l'immagine.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Il browser non riesce a elaborare l'immagine.");
  if (blob.size > MAX_BYTES) throw new Error("L'immagine è troppo pesante anche in PNG: esportala a una risoluzione più bassa.");
  return blob;
}

export function BaseUploader({ hasBase }: { hasBase: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send(method: "POST" | "DELETE", body?: Blob) {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/pianta/base", { method, body, headers: body ? { "Content-Type": body.type || "image/png" } : undefined });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.message ?? "Operazione non riuscita. Riprova.");
      setResult({ ok: true, message: method === "DELETE" ? "Base rimossa: lo schema torna al disegno automatico." : "Base caricata: la trovi nello schema della mappa." });
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
        aria-label="Base disegnata della mappa"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn ${hasBase ? "btn-secondary" : "btn-primary"}`} disabled={busy} onClick={() => input.current?.click()}>
          <ImageUp size={16} aria-hidden="true" />
          {busy ? "Caricamento…" : hasBase ? "Sostituisci la base" : "Carica la base disegnata"}
        </button>
        {hasBase && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Rimuovere la base disegnata? Lo schema tornerà al disegno automatico.")) void send("DELETE");
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
