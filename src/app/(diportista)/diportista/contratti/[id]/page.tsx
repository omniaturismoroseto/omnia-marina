import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ContractDocument, loadContractDocument } from "@/components/contract-document";
import { DocumentTitle } from "@/components/document-title";
import { page } from "@/components/page";
import { PrintButton } from "@/components/print-button";
import { requireOwner } from "@/lib/context";
import { uuidOrNull } from "@/lib/params";

export const metadata: Metadata = { title: "Il contratto" };

// Il contratto come lo stampa l'ufficio. Solo contratti del proprio cliente, attivi o conclusi.
export default page(async function OwnerContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOwner();
  const id = uuidOrNull((await params).id);
  if (!id) notFound();
  const row = await loadContractDocument(ctx.marinaId, id);
  if (!row || row.contract.ownerId !== ctx.ownerId || !["attivo", "concluso"].includes(row.contract.status)) notFound();
  const c = row.contract;

  return (
    <>
      <DocumentTitle title={`Contratto ${(c.number ?? "").replace("/", "-")} - ${row.owner.displayName}`} />
      <div className="no-print mb-5">
        <Link href="/diportista" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft size={16} aria-hidden="true" />
          La mia barca
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold text-ink">Contratto {c.number}</h1>
            <p className="mt-1 text-sm text-muted">Per salvarlo sul telefono o sul computer: «Stampa» e poi «Salva come PDF».</p>
          </div>
          <PrintButton label="Stampa o salva PDF" />
        </div>
      </div>
      <ContractDocument marinaId={ctx.marinaId} row={row} />
    </>
  );
});
