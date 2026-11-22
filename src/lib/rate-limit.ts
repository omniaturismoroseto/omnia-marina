// Freno ai tentativi ripetuti (accesso, «password dimenticata», attivazione dell'area diportista).
// È in memoria: vale per singola istanza del server. Le voci scadute si tolgono man mano, così la mappa non cresce
// all'infinito anche se arrivano richieste da moltissimi indirizzi diversi.

export interface RateLimiter {
  /** Vero se la chiave ha già raggiunto il massimo nella finestra in corso. */
  blocked(key: string): boolean;
  /** Conta un tentativo e restituisce quanti ne ha fatti la chiave nella finestra in corso. */
  hit(key: string): number;
  /** Azzera la chiave (per esempio dopo un accesso riuscito). */
  clear(key: string): void;
}

const PRUNE_ABOVE = 5000;

export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const entries = new Map<string, { count: number; resetAt: number }>();

  function prune(at: number) {
    if (entries.size < PRUNE_ABOVE) return;
    for (const [key, entry] of entries) if (entry.resetAt <= at) entries.delete(key);
  }

  return {
    blocked(key) {
      const entry = entries.get(key);
      return !!entry && entry.resetAt > now() && entry.count >= max;
    },
    hit(key) {
      const at = now();
      prune(at);
      const entry = entries.get(key);
      if (!entry || entry.resetAt <= at) {
        entries.set(key, { count: 1, resetAt: at + windowMs });
        return 1;
      }
      entry.count++;
      return entry.count;
    },
    clear(key) {
      entries.delete(key);
    },
  };
}

/**
 * Indirizzo del client per i freni ai tentativi. Su Cloud Run il servizio di Google aggiunge l'indirizzo vero in fondo
 * a X-Forwarded-For: i valori prima li può scrivere chiunque, quindi si usa l'ultimo.
 */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const last = forwardedFor?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last ?? realIp?.trim() ?? "sconosciuto";
}
