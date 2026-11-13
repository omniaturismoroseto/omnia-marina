import type { FormState } from "@/lib/forms";

// Errore "di dominio": una regola del porto non rispettata, da mostrare all'utente così com'è.
export class DomainError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

function pgCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

// Traduce gli errori attesi in un messaggio per il modulo; tutto il resto viene rilanciato.
export function toFormState(err: unknown): NonNullable<FormState> {
  if (err instanceof DomainError) {
    return { message: err.message, errors: err.field ? { [err.field]: err.message } : undefined };
  }
  const code = pgCode(err);
  if (code === "23P01") return { message: "Il posto barca è già assegnato a un altro contratto in quel periodo." };
  if (code === "23505") return { message: "Esiste già un elemento con lo stesso codice." };
  if (code === "23503") return { message: "Operazione non possibile: ci sono altri dati collegati a questo elemento." };
  throw err;
}
