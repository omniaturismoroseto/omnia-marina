import type { Metadata } from "next";
import { page } from "@/components/page";
import { Card, Details } from "@/components/ui";
import { requireOwner } from "@/lib/context";
import { OwnPasswordForm } from "../../../(app)/impostazioni/settings-forms";

export const metadata: Metadata = { title: "Il tuo accesso" };

export default page(async function OwnerAccountPage() {
  const ctx = await requireOwner();
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Il tuo accesso</h1>
      <div className="mt-6 grid grid-cols-1 items-start gap-5 sm:grid-cols-2">
        <Card title="Dati">
          <Details
            columns={1}
            items={[
              ["Nome", ctx.user.name],
              ["Email", ctx.user.email],
              ["Porto", ctx.marinaName],
              ["Intestatario", ctx.ownerName],
            ]}
          />
          <p className="hint mt-3">Per cambiare nome o email rivolgiti all&apos;ufficio del porto.</p>
        </Card>
        <Card title="Cambia password">
          <OwnPasswordForm />
        </Card>
      </div>
    </>
  );
});
