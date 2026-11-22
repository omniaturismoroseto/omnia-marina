"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { audit } from "@/lib/audit";
import { OFFICE, requireMarina } from "@/lib/context";
import { todayRome } from "@/lib/dates";
import { fail, formId, type FormState } from "@/lib/forms";
import { checkRows, hasBlockingIssues, MAX_IMPORT_ROWS, toLedgerEntries } from "@/lib/ledger-import";
import { importLedger, undoLedgerImport } from "./accounting";
import { toFormState } from "./errors";

const cents = z.number().int().min(-10_000_000_000).max(10_000_000_000).nullable();
const text = (max: number) => z.string().max(max);

const payloadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  sheetName: text(200),
  rows: z
    .array(
      z.object({
        row: z.number().int().positive(),
        date: z.string().nullable(),
        causale: text(200),
        method: text(200),
        note: text(500),
        receipt: text(50),
        year: text(50),
        name: text(500),
        amountCents: cents,
        bankCents: cents,
        excluded: z.boolean(),
      }),
    )
    .min(1)
    .max(MAX_IMPORT_ROWS),
});

// Importa la prima nota controllata nell'anteprima. I controlli bloccanti vengono ripetuti qui:
// il browser manda le righe, il server decide che cosa salvare.
export async function importLedgerFile(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return fail("Dati dell'anteprima non leggibili: ricarica il file.");
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return fail("Dati dell'anteprima non validi: ricarica il file.");
  const { rows, ...file } = parsed.data;

  if (hasBlockingIssues(checkRows(rows, todayRome()))) {
    return fail("Ci sono ancora righe da sistemare (data mancante o importo vuoto): correggile o escludile.");
  }
  const entries = toLedgerEntries(rows);
  try {
    await db.transaction(async (tx) => {
      const id = await importLedger(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, { ...file, rowsCount: rows.filter((r) => !r.excluded).length, entries });
      await audit(ctx, "importazione", "prima nota", id, `${file.fileName} · ${entries.length} movimenti`, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: `Importazione completata: ${entries.length} movimenti aggiunti alla prima nota.` };
}

export async function removeLedgerImport(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireMarina(OFFICE);
  const importId = formId(formData, "importId");
  if (!importId) return fail("Importazione non trovata.");
  try {
    await db.transaction(async (tx) => {
      const done = await undoLedgerImport(tx, { marinaId: ctx.marinaId, userId: ctx.user.id }, importId);
      await audit(ctx, "annullamento importazione", "prima nota", importId, `${done.fileName} · ${done.entriesCount} movimenti`, tx);
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
