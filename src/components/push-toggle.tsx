"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "@/components/icons";
import { removePushSubscription, savePushSubscription } from "@/server/message-actions";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "error";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Attiva o spegne le notifiche dei messaggi del porto su questo dispositivo. */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!publicKey) return setState("unsupported");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("error"));
  }, [publicKey]);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey!) }));
      const ok = await savePushSubscription(sub.toJSON());
      setState(ok ? "on" : "error");
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      {state === "on" ? <Bell size={20} className="text-sea" aria-hidden="true" /> : <BellOff size={20} className="text-muted" aria-hidden="true" />}
      <p className="min-w-0 flex-1 text-sm text-ink">
        {state === "on" && "Notifiche attive su questo dispositivo: ti avvisiamo quando arriva un messaggio dal porto."}
        {state === "off" && "Vuoi un avviso sul telefono quando il porto ti scrive?"}
        {state === "denied" && "Le notifiche sono bloccate per questo sito: riattivale dalle impostazioni del browser."}
        {state === "error" && "Non è stato possibile attivare le notifiche. Riprova più tardi."}
        {state === "ios-install" && (
          <>
            Per ricevere le notifiche su iPhone aggiungi l&apos;app alla schermata Home: tocca <strong>Condividi</strong> e poi{" "}
            <strong>Aggiungi alla schermata Home</strong>, poi aprila da lì.
          </>
        )}
      </p>
      {(state === "off" || state === "error") && (
        <button type="button" className="btn btn-primary btn-sm" onClick={enable} disabled={busy}>
          {busy ? "Attendere…" : "Attiva le notifiche"}
        </button>
      )}
      {state === "on" && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={disable} disabled={busy}>
          Spegni
        </button>
      )}
    </div>
  );
}
