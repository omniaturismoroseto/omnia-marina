"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2 } from "@/components/icons";

// La foto si riduce nel browser prima dell'invio: lato lungo 1600 px in JPEG, così pesa poche centinaia di kB
// anche quando arriva dalla fotocamera del telefono.
const MAX_SIDE = 1600;

async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("Il file scelto non è una foto leggibile (usa JPEG o PNG).");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Il browser non riesce a elaborare la foto.");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Il browser non riesce a elaborare la foto.");
  return blob;
}

/** Pulsanti per caricare (o scattare) e togliere la foto della barca. */
export function BoatPhotoButton({
  boatId,
  hasPhoto,
  variant = "full",
}: {
  boatId: string;
  hasPhoto: boolean;
  // full: pulsanti nella scheda barca; overlay: sopra l'immagine; link: piccolo collegamento sotto il nome
  variant?: "full" | "overlay" | "link";
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", body?: Blob) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/barche/${boatId}/foto`, { method, body, headers: body ? { "Content-Type": "image/jpeg" } : undefined });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (!response.ok || !data?.ok) throw new Error(data?.message ?? "Operazione non riuscita. Riprova.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operazione non riuscita. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      await send("POST", await prepare(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operazione non riuscita. Riprova.");
      setBusy(false);
    }
  }

  const label = busy ? "Caricamento…" : hasPhoto ? "Cambia foto" : "Aggiungi foto";
  return (
    <div className={variant === "overlay" ? "contents" : variant === "link" ? "" : "space-y-2"}>
      {/* Sul telefono il selettore propone sia la fotocamera sia la galleria. */}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Foto della barca"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {variant === "link" ? (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="link mt-1 inline-flex cursor-pointer items-center gap-1 text-[13px] disabled:opacity-60">
          <ImageUp size={14} aria-hidden="true" />
          {label}
        </button>
      ) : variant === "overlay" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="absolute right-2 bottom-2 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-card/95 px-3 text-xs font-medium text-ink shadow-sm hover:bg-white disabled:opacity-60"
        >
          <ImageUp size={15} aria-hidden="true" />
          {label}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`btn ${hasPhoto ? "btn-secondary" : "btn-primary"}`} disabled={busy} onClick={() => input.current?.click()}>
            <ImageUp size={16} aria-hidden="true" />
            {label}
          </button>
          {hasPhoto && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Togliere la foto? Al suo posto comparirà la sagoma del tipo di barca.")) void send("DELETE");
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
              Togli la foto
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className={`rounded-md bg-bad-soft px-3 py-2 text-sm text-bad ${variant === "overlay" ? "absolute inset-x-2 top-12" : variant === "link" ? "mt-1" : ""}`}>
          {error}
        </p>
      )}
    </div>
  );
}
