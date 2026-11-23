import Link from "next/link";
import type { ReactNode } from "react";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { BoatPicture } from "@/components/boat-picture";
import { BoatPhotoButton } from "@/components/boat-photo-button";
import { Droplets, FileText, Phone, UserRound, X, Zap } from "@/components/icons";
import { MovementButtons } from "@/components/movement-buttons";
import { Badge, ButtonLink } from "@/components/ui";
import { db } from "@/db";
import { boats, contracts, owners } from "@/db/schema";
import { boatFit, boatModelLabel, initials, stayOf } from "@/lib/berth-panel";
import { contractNumberLabel } from "@/lib/contract-numbers";
import { formatDate } from "@/lib/dates";
import { formatDimensions, formatMeters } from "@/lib/format";
import { BERTH_STATUS_LABEL, BOAT_TYPE_LABEL, CONTRACT_TYPE_LABEL } from "@/lib/labels";
import { qs } from "@/lib/params";
import { STATE_LABEL, type BerthState, type BoardBerth, type Occupant } from "@/server/board";

// Riquadro del posto scelto sulla mappa. Due versioni:
// - ufficio e direzione: scheda con la foto (o la sagoma) della barca, proprietario, contratto con il periodo;
// - banchina: fascia colorata con lo stato e righe grandi da toccare col telefono.

type Tone = "ok" | "sea" | "warn" | "buoy" | "bad" | "neutral";

export const STATE_TONE: Record<BerthState, Tone> = {
  libero: "ok",
  occupato: "sea",
  fuori: "sea",
  atteso: "warn",
  partenza: "buoy",
  ritardo: "bad",
  fermo: "neutral",
};

const BAND: Record<Tone, string> = {
  ok: "bg-ok text-white",
  sea: "bg-sea text-white",
  warn: "bg-warn-soft text-warn",
  buoy: "bg-buoy text-white",
  bad: "bg-bad text-white",
  neutral: "bg-line-soft text-ink",
};

interface PanelProps {
  berth: BoardBerth;
  pierName: string | null;
  date: string;
  today: string;
  marinaId: string;
  office: boolean;
  closeHref: string | null;
}

const telHref = (phone: string) => `tel:${phone.replace(/\s/g, "")}`;

function BerthFacts({ berth }: { berth: BoardBerth }) {
  const chip = "inline-flex items-center gap-1 rounded-md border border-line-soft bg-paper px-2 py-1 text-[13px] text-ink";
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Caratteristiche del posto">
      <li className={chip}>Posto {formatDimensions(berth.lengthCm, berth.beamCm)}</li>
      {berth.draftCm && <li className={chip}>fondale {formatMeters(berth.draftCm)}</li>}
      {berth.hasWater && (
        <li className={chip}>
          <Droplets size={14} className="text-sea" aria-hidden="true" /> acqua
        </li>
      )}
      {berth.hasPower && (
        <li className={chip}>
          <Zap size={14} className="text-sea" aria-hidden="true" /> corrente
        </li>
      )}
      {berth.categoryName && <li className={chip}>Categoria {berth.categoryName}</li>}
    </ul>
  );
}

function OutOfService({ berth }: { berth: BoardBerth }) {
  if (berth.status === "attivo") return null;
  return (
    <p className="rounded-md bg-line-soft px-3 py-2 text-sm text-ink">
      {BERTH_STATUS_LABEL[berth.status]}
      {berth.notes ? ` · ${berth.notes}` : ""}
    </p>
  );
}

const CLOSE = {
  plain: "text-muted hover:bg-line-soft hover:text-ink",
  band: "text-current hover:bg-white/15",
  overlay: "bg-card/95 text-ink shadow-sm hover:bg-white",
};

function CloseLink({ href, look }: { href: string; look: keyof typeof CLOSE }) {
  return (
    <Link href={href} aria-label="Chiudi il riquadro del posto" className={`grid size-9 shrink-0 place-items-center rounded-full ${CLOSE[look]}`}>
      <X size={18} aria-hidden="true" />
    </Link>
  );
}

function Movements({ o, date, today, large = false }: { o: Occupant; date: string; today: string; large?: boolean }) {
  if (date !== today) return null;
  return <MovementButtons contractId={o.contractId} presence={o.presence} canArrive={o.startDate <= today} departing={o.endDate <= today} earlyDeparture size={large ? "lg" : undefined} />;
}

function Incoming({ berth }: { berth: BoardBerth }) {
  if (!berth.incoming) return null;
  return (
    <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
      Oggi è atteso anche <strong>{berth.incoming.boatName}</strong> su questo posto.
    </p>
  );
}

function boatOf(o: Occupant) {
  return { id: o.boatId, name: o.boatName, type: o.boatType, hasPhoto: o.boatHasPhoto, photoVersion: o.boatPhotoVersion };
}

/** Riga descrittiva della barca: tipo, cantiere e modello (se diversi dal nome), misure. */
function boatLine(o: Occupant): string {
  // Le misure non vanno a capo a metà («11,55 × 6,53 m» resta su una riga).
  const size = formatDimensions(o.boatLengthCm, o.boatBeamCm).replace(/ /g, "\u00a0");
  return [BOAT_TYPE_LABEL[o.boatType], boatModelLabel({ name: o.boatName, builder: o.boatBuilder, model: o.boatModel }), size]
    .filter(Boolean)
    .join(" · ");
}

async function upcomingOf(marinaId: string, berthId: string, date: string) {
  return db
    .select({ id: contracts.id, number: contracts.number, status: contracts.status, startDate: contracts.startDate, endDate: contracts.endDate, boatName: boats.name, ownerName: owners.displayName })
    .from(contracts)
    .innerJoin(boats, eq(boats.id, contracts.boatId))
    .innerJoin(owners, eq(owners.id, contracts.ownerId))
    .where(and(eq(contracts.marinaId, marinaId), eq(contracts.berthId, berthId), inArray(contracts.status, ["attivo", "bozza"]), gt(contracts.startDate, date)))
    .orderBy(asc(contracts.startDate))
    .limit(4);
}

function Upcoming({ rows, office }: { rows: Awaited<ReturnType<typeof upcomingOf>>; office: boolean }) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-line-soft pt-3">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Prossime assegnazioni</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((u) => (
          <li key={u.id} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0">
              {/* A chi è intestato il contratto, poi la barca; l'ufficio apre il contratto. */}
              {office ? (
                <Link href={`/contratti/${u.id}`} className="link block truncate font-medium">
                  {u.ownerName}
                </Link>
              ) : (
                <span className="block truncate font-medium">{u.ownerName}</span>
              )}
              <span className="block truncate text-xs text-muted">
                {u.boatName}
                {u.status === "bozza" ? " · bozza" : u.number ? ` · ${contractNumberLabel(u.number)}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {formatDate(u.startDate)} – {formatDate(u.endDate)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FreeBerth({ berth, date, office }: { berth: BoardBerth; date: string; office: boolean }) {
  if (berth.status !== "attivo") return null;
  return (
    <div className="border-t border-line-soft pt-4">
      <p className="text-sm text-muted">Nessuna barca assegnata il {formatDate(date)}.</p>
      {office && (
        <ButtonLink href={`/contratti/nuovo${qs({ posto: berth.id, dal: date })}`} variant="primary" className="mt-3">
          Assegna il posto
        </ButtonLink>
      )}
    </div>
  );
}

export async function BerthPanel(props: PanelProps) {
  const upcoming = await upcomingOf(props.marinaId, props.berth.id, props.date);
  return props.office ? <OfficePanel {...props} upcoming={<Upcoming rows={upcoming} office />} /> : <DockPanel {...props} upcoming={<Upcoming rows={upcoming} office={false} />} />;
}

// ───────────── Ufficio e direzione: scheda con la foto ─────────────

function OfficePanel({ berth, pierName, date, today, closeHref, upcoming }: PanelProps & { upcoming: ReactNode }) {
  const o = berth.occupant;
  const place = `Posto ${berth.code}${pierName ? ` · ${pierName}` : ""}`;
  const badge = <Badge tone={STATE_TONE[berth.state]}>{STATE_LABEL[berth.state]}</Badge>;

  if (!o) {
    return (
      <div className="card space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted">Posto barca{pierName ? ` · ${pierName}` : ""}</p>
            <h2 className="text-3xl leading-none font-bold">{berth.code}</h2>
          </div>
          <div className="flex items-center gap-1">
            {badge}
            {closeHref && <CloseLink href={closeHref} look="plain" />}
          </div>
        </div>
        <BerthFacts berth={berth} />
        <OutOfService berth={berth} />
        <FreeBerth berth={berth} date={date} office />
        {upcoming}
      </div>
    );
  }

  const stay = stayOf(o.startDate, o.endDate, date);
  return (
    <div className="card overflow-hidden">
      <div className="relative">
        <BoatPicture boat={boatOf(o)} />
        {closeHref && (
          <div className="absolute top-2 left-2">
            <CloseLink href={closeHref} look="overlay" />
          </div>
        )}
        <BoatPhotoButton boatId={o.boatId} hasPhoto={o.boatHasPhoto} variant="overlay" />
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted">{place}</p>
            <h2 className="text-xl leading-tight font-bold">
              <Link href={`/barche/${o.boatId}`} className="hover:underline">
                {o.boatName}
              </Link>
            </h2>
            <p className="text-sm text-muted">{boatLine(o)}</p>
          </div>
          {badge}
        </div>

        <div className="flex items-center gap-3 border-t border-line-soft pt-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sea-soft text-sm font-bold text-sea-dark" aria-hidden="true">
            {initials(o.ownerName)}
          </span>
          <div className="min-w-0">
            <Link href={`/clienti/${o.ownerId}`} className="link block truncate font-medium">
              {o.ownerName}
            </Link>
            <p className="text-sm text-muted tabular-nums">{o.ownerPhone ?? "Telefono non indicato"}</p>
          </div>
          {o.ownerPhone && (
            <a href={telHref(o.ownerPhone)} aria-label={`Chiama ${o.ownerName}`} className="ml-auto grid size-10 shrink-0 place-items-center rounded-full bg-ok-soft text-ok hover:bg-ok hover:text-white">
              <Phone size={19} aria-hidden="true" />
            </a>
          )}
        </div>

        <div className="space-y-2 border-t border-line-soft pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/contratti/${o.contractId}`} className="link font-medium">
              Contratto {contractNumberLabel(o.number)}
            </Link>
            <span className="text-sm text-muted">{CONTRACT_TYPE_LABEL[o.type]}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden="true">
            <div className={`h-full rounded-full ${stay.late ? "bg-bad" : "bg-sea"}`} style={{ width: `${Math.round(stay.progress * 100)}%` }} />
          </div>
          <p className="flex justify-between gap-2 text-[13px] text-muted tabular-nums">
            <span>{formatDate(o.startDate)}</span>
            <span className={stay.late ? "font-medium text-bad" : "font-medium text-ink"}>{stay.label}</span>
            <span>{formatDate(o.endDate)}</span>
          </p>
        </div>

        <BerthFacts berth={berth} />
        <OutOfService berth={berth} />
        <Movements o={o} date={date} today={today} />
        <Incoming berth={berth} />
        {upcoming}
      </div>
    </div>
  );
}

// ───────────── Banchina: fascia dello stato e righe grandi ─────────────

function Row({ icon, children, note }: { icon: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <li className="flex min-h-14 items-center gap-3 border-t border-line-soft py-2.5">
      <span className="shrink-0 text-sea">{icon}</span>
      <div className="min-w-0">
        <div className="truncate">{children}</div>
        {note && <p className="text-[13px] text-muted">{note}</p>}
      </div>
    </li>
  );
}

function DockPanel({ berth, pierName, date, today, closeHref, upcoming }: PanelProps & { upcoming: ReactNode }) {
  const o = berth.occupant;
  const tone = STATE_TONE[berth.state];
  const stay = o ? stayOf(o.startDate, o.endDate, date) : null;
  const fit = o ? boatFit(berth, { lengthCm: o.boatLengthCm, beamCm: o.boatBeamCm }) : null;

  return (
    <div className="card overflow-hidden">
      <div className={`flex items-center justify-between gap-2 px-4 py-3 ${BAND[tone]}`}>
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-bold">
            {berth.code} · {STATE_LABEL[berth.state]}
          </h2>
          <p className="truncate text-[13px] opacity-90">
            {[pierName, stay?.label].filter(Boolean).join(" · ") || "Posto barca"}
          </p>
        </div>
        {closeHref && <CloseLink href={closeHref} look={tone === "warn" || tone === "neutral" ? "plain" : "band"} />}
      </div>

      <div className="space-y-3 p-4">
        {o ? (
          <>
            <div className="flex items-center gap-3">
              <div className="relative w-28 shrink-0 overflow-hidden rounded-md">
                <BoatPicture boat={boatOf(o)} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[17px] leading-tight font-bold">{o.boatName}</p>
                <p className="text-sm text-muted">{boatLine(o)}</p>
                {fit && (
                  <p className={`text-[13px] font-medium ${fit.fits ? "text-ok" : "text-bad"}`}>
                    {fit.fits ? "Ci sta" : "Più grande del posto"}: posto {formatDimensions(berth.lengthCm, berth.beamCm)}
                  </p>
                )}
                <BoatPhotoButton boatId={o.boatId} hasPhoto={o.boatHasPhoto} variant="link" />
              </div>
            </div>

            <ul>
              <Row icon={<UserRound size={20} aria-hidden="true" />} note="Proprietario">
                <span className="font-medium">{o.ownerName}</span>
              </Row>
              {o.ownerPhone && (
                <Row icon={<Phone size={20} aria-hidden="true" />} note="Tocca per chiamare">
                  <a href={telHref(o.ownerPhone)} className="link font-medium tabular-nums">
                    {o.ownerPhone}
                  </a>
                </Row>
              )}
              <Row icon={<FileText size={20} aria-hidden="true" />} note={`${formatDate(o.startDate)} – ${formatDate(o.endDate)}`}>
                {contractNumberLabel(o.number)} · {CONTRACT_TYPE_LABEL[o.type]}
              </Row>
              {(berth.hasWater || berth.hasPower) && (
                <Row icon={berth.hasWater ? <Droplets size={20} aria-hidden="true" /> : <Zap size={20} aria-hidden="true" />} note={berth.categoryName ? `Categoria ${berth.categoryName}` : undefined}>
                  {berth.hasWater && berth.hasPower ? "Acqua e corrente" : berth.hasWater ? "Acqua" : "Corrente"}
                </Row>
              )}
            </ul>
            <OutOfService berth={berth} />
            <Movements o={o} date={date} today={today} large />
            <Incoming berth={berth} />
          </>
        ) : (
          <>
            <BerthFacts berth={berth} />
            <OutOfService berth={berth} />
            <FreeBerth berth={berth} date={date} office={false} />
          </>
        )}
        {upcoming}
      </div>
    </div>
  );
}
