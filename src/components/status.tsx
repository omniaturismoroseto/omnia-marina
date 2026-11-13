import { Badge } from "@/components/ui";
import type { ContractStatus, Presence } from "@/db/schema";
import { CONTRACT_STATUS_LABEL, PRESENCE_LABEL } from "@/lib/labels";
import type { ChargeStatus } from "@/server/accounting";

const CHARGE: Record<ChargeStatus, [label: string, tone: "ok" | "warn" | "bad" | "neutral" | "sea"]> = {
  pagato: ["Pagato", "ok"],
  parziale: ["Acconto versato", "sea"],
  aperto: ["Da incassare", "warn"],
  scaduto: ["Scaduto", "bad"],
  annullato: ["Annullato", "neutral"],
};

export function ChargeStatusBadge({ status }: { status: ChargeStatus }) {
  const [label, tone] = CHARGE[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const CONTRACT_TONE: Record<ContractStatus, "ok" | "warn" | "neutral" | "bad"> = { attivo: "ok", bozza: "warn", concluso: "neutral", annullato: "bad" };

export function ContractStatusBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={CONTRACT_TONE[status]}>{CONTRACT_STATUS_LABEL[status]}</Badge>;
}

const PRESENCE_TONE: Record<Presence, "ok" | "warn" | "neutral" | "sea"> = { in_porto: "sea", fuori: "sea", atteso: "warn", partito: "neutral" };

export function PresenceBadge({ presence }: { presence: Presence }) {
  return <Badge tone={PRESENCE_TONE[presence]}>{PRESENCE_LABEL[presence]}</Badge>;
}
