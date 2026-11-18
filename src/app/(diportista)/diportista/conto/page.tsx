import type { Metadata } from "next";
import { page } from "@/components/page";
import { ChargeStatusBadge } from "@/components/status";
import { Card } from "@/components/ui";
import { requireOwner } from "@/lib/context";
import { formatDate, todayRome } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { ownerCharges } from "@/server/owner-area";

export const metadata: Metadata = { title: "Estratto conto" };

export default page(async function OwnerAccountStatementPage() {
  const ctx = await requireOwner();
  const today = todayRome();
  const rows = await ownerCharges({ marinaId: ctx.marinaId, ownerId: ctx.ownerId }, today);
  const billed = rows.reduce((s, c) => s + c.grossCents, 0);
  const paid = rows.reduce((s, c) => s + Math.min(c.paidCents, c.grossCents), 0);
  const overdue = rows.filter((c) => c.status === "scaduto").reduce((s, c) => s + c.grossCents - c.paidCents, 0);

  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-ink">Estratto conto</h1>
      <p className="mt-1 text-[15px] text-muted">Importi richiesti dal porto e pagamenti registrati. Per un chiarimento contatta l&apos;ufficio.</p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <div className="card p-3">
          <p className="text-xs text-muted">Richiesto</p>
          <p className="mt-0.5 font-semibold text-ink tabular-nums">{formatMoney(billed)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Pagato</p>
          <p className="mt-0.5 font-semibold text-ok tabular-nums">{formatMoney(paid)}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-muted">Da pagare</p>
          <p className={`mt-0.5 font-semibold tabular-nums ${billed - paid > 0 ? (overdue > 0 ? "text-bad" : "text-ink") : "text-ok"}`}>{formatMoney(billed - paid)}</p>
        </div>
      </div>

      <Card title="Movimenti" className="mt-5" flush>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nessun importo registrato.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{c.description}</p>
                  <p className="text-xs text-muted">
                    Scadenza {formatDate(c.dueDate)}
                    {c.paidCents > 0 && c.paidCents < c.grossCents ? ` · pagati ${formatMoney(c.paidCents)}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-ink tabular-nums">{formatMoney(c.grossCents)}</p>
                  <ChargeStatusBadge status={c.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
});
