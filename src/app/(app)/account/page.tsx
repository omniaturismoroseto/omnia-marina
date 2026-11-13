import type { Metadata } from "next";
import { page } from "@/components/page";
import { Card, Details, PageHeader } from "@/components/ui";
import { requireMarina } from "@/lib/context";
import { ROLE_LABEL } from "@/lib/labels";
import { OwnPasswordForm } from "../impostazioni/settings-forms";

export const metadata: Metadata = { title: "Il mio account" };

export default page(async function AccountPage() {
  const ctx = await requireMarina();
  return (
    <>
      <PageHeader title="Il mio account" />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card title="Profilo">
          <Details
            columns={1}
            items={[
              ["Nome", ctx.user.name],
              ["Email", ctx.user.email],
              ["Porto", ctx.marinaName],
              ["Ruolo", ROLE_LABEL[ctx.role]],
            ]}
          />
        </Card>
        <Card title="Password">
          <OwnPasswordForm />
        </Card>
      </div>
    </>
  );
});
