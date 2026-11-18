import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContractDocument, loadContractDocument } from "@/components/contract-document";
import { DocumentTitle } from "@/components/document-title";
import { page } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/ui";
import { OFFICE, requireMarina } from "@/lib/context";
import { uuidOrNull } from "@/lib/params";

export const metadata: Metadata = { title: "Stampa contratto" };

export default page(async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMarina(OFFICE);
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const row = await loadContractDocument(ctx.marinaId, id);
  if (!row) notFound();
  const { contract: c, owner } = row;

  return (
    <>
      <DocumentTitle title={c.number ? `Contratto ${c.number.replace("/", "-")} - ${owner.displayName}` : `Bozza contratto - ${owner.displayName}`} />
      <div className="no-print">
        <PageHeader
          title={c.number ? `Contratto ${c.number}` : "Contratto in bozza"}
          description="Anteprima di stampa. Per averne un file, stampa e scegli «Salva come PDF»: il nome riporta numero e cliente."
          back={{ href: `/contratti/${id}`, label: "Scheda contratto" }}
          actions={<PrintButton />}
        />
      </div>
      <ContractDocument marinaId={ctx.marinaId} row={row} />
    </>
  );
});
