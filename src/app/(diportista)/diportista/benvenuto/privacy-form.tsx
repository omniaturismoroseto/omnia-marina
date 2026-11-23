"use client";

import { CheckboxField, Form, FormMessage, Submit, useFormResult } from "@/components/form";
import { acceptAppPrivacyAction } from "@/server/owner-privacy-actions";

function AcceptError() {
  const { state } = useFormResult();
  const error = state?.errors?.accept;
  return error ? <p className="text-sm text-bad">{error}</p> : null;
}

export function PrivacyForm() {
  return (
    <Form action={acceptAppPrivacyAction} className="space-y-4">
      <CheckboxField name="accept" label="Ho letto l'informativa sul trattamento dei dati personali e sull'uso dell'app." />
      <AcceptError />
      <FormMessage />
      <Submit size="lg" className="w-full sm:w-auto">
        Accetto e continuo
      </Submit>
    </Form>
  );
}
