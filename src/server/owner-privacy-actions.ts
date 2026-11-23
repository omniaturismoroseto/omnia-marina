"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/context";
import { f, fail, parseForm, type FormState } from "@/lib/forms";
import { toFormState } from "./errors";
import { acceptAppPrivacy } from "./owner-access";

const schema = z.object({ accept: f.checkbox() });

/** Primo accesso del diportista: accettazione dell'informativa dell'app, poi il passo delle notifiche. */
export async function acceptAppPrivacyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireOwner({ allowPrivacyPending: true });
  const parsed = parseForm(schema, formData);
  if (!parsed.ok) return parsed.state;
  if (!parsed.data.accept) return fail("Per usare l'app spunta la casella dopo aver letto l'informativa.", { accept: "Spunta la casella per continuare." });
  // L'account manager in prova vede il percorso ma non accetta al posto del cliente.
  if (!ctx.preview) {
    try {
      await acceptAppPrivacy(ctx);
    } catch (error) {
      return toFormState(error);
    }
    revalidatePath(`/clienti/${ctx.ownerId}`);
  }
  redirect("/diportista/benvenuto?passo=notifiche");
}
