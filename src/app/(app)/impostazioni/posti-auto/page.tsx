import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { page } from "@/components/page";
import { Card, Notice, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { contractItems, contracts, marinas, owners, parkingSpaces } from "@/db/schema";
import { compareCodes } from "@/lib/berth-codes";
import { requireMarina } from "@/lib/context";
import { todayRome } from "@/lib/dates";
import { loadPlanMap } from "@/server/plan-map";
import { SettingsTabs } from "../tabs";
import { ParkingEditor } from "./parking-editor";
import { CreateParkingForm, ParkingList, type ParkingRow } from "./parking-forms";

export const metadata: Metadata = { title: "Posti auto" };

export default page(async function ParkingSettingsPage() {
  const ctx = await requireMarina(["admin"]);
  const today = todayRome();
  const [rows, usedRows, todayRows, map, [marina]] = await Promise.all([
    db.select().from(parkingSpaces).where(eq(parkingSpaces.marinaId, ctx.marinaId)),
    // Posti auto che compaiono in un contratto (anche concluso): non si eliminano.
    db
      .selectDistinct({ id: contractItems.parkingSpaceId })
      .from(contractItems)
      .where(and(eq(contractItems.marinaId, ctx.marinaId), isNotNull(contractItems.parkingSpaceId))),
    // Chi ha ogni posto auto oggi.
    db
      .select({ id: contractItems.parkingSpaceId, owner: owners.displayName, number: contracts.number })
      .from(contractItems)
      .innerJoin(contracts, eq(contracts.id, contractItems.contractId))
      .innerJoin(owners, eq(owners.id, contracts.ownerId))
      .where(
        and(
          eq(contractItems.marinaId, ctx.marinaId),
          isNotNull(contractItems.parkingSpaceId),
          inArray(contracts.status, ["attivo", "concluso"]),
          lte(contractItems.startDate, today),
          gte(contractItems.endDate, today),
        ),
      ),
    loadPlanMap(ctx.marinaId),
    db.select({ version: marinas.planVersion }).from(marinas).where(eq(marinas.id, ctx.marinaId)),
  ]);
  const used = new Set(usedRows.map((r) => r.id));
  const holder = new Map(todayRows.map((r) => [r.id, `${r.owner}${r.number ? ` (contratto ${r.number})` : ""}`]));
  const sorted = [...rows].sort((a, b) => compareCodes(a.code, b.code));
  const list: ParkingRow[] = sorted.map((r) => ({
    id: r.id,
    code: r.code,
    covered: r.covered,
    lengthCm: r.lengthCm,
    widthCm: r.widthCm,
    active: r.active,
    notes: r.notes,
    onPlan: r.planX !== null,
    used: used.has(r.id),
    today: holder.get(r.id) ?? null,
  }));
  // Numero da proporre per i nuovi: dopo il più alto con la sigla P.
  const numbers = rows.map((r) => /^P(\d+)$/.exec(r.code)).flatMap((m) => (m ? [Number(m[1])] : []));
  const nextNumber = numbers.length ? Math.max(...numbers) + 1 : 1;

  return (
    <>
      <PageHeader
        help="impostazioni"
        title="Impostazioni"
        description="Posti auto riservati del porto: si mettono sulla mappa e si assegnano nei contratti, come i posti barca."
      />
      <SettingsTabs current="postiauto" />
      <div className="space-y-5">
        <Card title="Nuovi posti auto">
          <p className="mb-3 max-w-3xl text-sm text-muted">
            Crea i posti auto in blocco, per esempio da P1 a P20. Coperti e scoperti si scelgono nelle voci corrispondenti del contratto
            («Posto auto coperto» / «Posto auto scoperto»); i prezzi restano quelli del listino in Tariffe → Servizi e cauzioni.
          </p>
          <CreateParkingForm nextNumber={nextNumber} />
        </Card>

        <Card title={`Posti auto (${list.length})`}>
          <ParkingList rows={list} />
        </Card>

        {/* data-wide: come la Mappa del porto, l'editor usa tutta la larghezza dello schermo (vedi il layout). */}
        <div data-wide>
          <Card title="Sulla mappa">
            {map ? (
              list.length > 0 ? (
                <ParkingEditor
                  key={`${list.length}:${marina?.version ?? 0}`}
                  map={map}
                  imageUrl={`/pianta/immagine?v=${marina?.version ?? 0}`}
                  initial={sorted.map((r) => ({
                    id: r.id,
                    code: r.code,
                    covered: r.covered,
                    lengthCm: r.lengthCm,
                    widthCm: r.widthCm,
                    active: r.active,
                    x: r.planX,
                    y: r.planY,
                    angle: r.planAngle,
                  }))}
                />
              ) : (
                <p className="text-sm text-muted">Crea prima i posti auto: poi li disponi qui.</p>
              )
            ) : (
              <Notice>
                Per mettere i posti auto sulla mappa serve la mappa del porto con la scala e i posti barca disposti: preparala in{" "}
                <Link href="/impostazioni/pianta" className="link">
                  Mappa del porto
                </Link>
                . Intanto i posti auto si possono già assegnare nei contratti.
              </Notice>
            )}
          </Card>
        </div>
      </div>
    </>
  );
});
