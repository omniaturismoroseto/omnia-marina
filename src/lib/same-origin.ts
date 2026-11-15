// Le richieste che modificano dati (caricamento di immagini) sono accettate solo dalle pagine dell'app stessa,
// non da altri siti.
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
