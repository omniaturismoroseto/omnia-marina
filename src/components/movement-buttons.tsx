import { ArrowDownToLine, ArrowUpFromLine, Undo2, Waves } from "lucide-react";
import { ActionButton } from "@/components/form";
import { registerMovement } from "@/server/dock-actions";

// Pulsanti di movimento coerenti con lo stato attuale della barca.
export function MovementButtons({
  contractId,
  presence,
  canArrive,
  departing,
  earlyDeparture = false,
  size,
}: {
  contractId: string;
  presence: "atteso" | "in_porto" | "fuori" | "partito";
  // false se l'arrivo è previsto in una data futura
  canArrive: boolean;
  // true se oggi è il giorno di partenza (o è già passato): la partenza diventa l'azione principale
  departing: boolean;
  // mostra anche "Partenza anticipata" quando la barca non è in scadenza
  earlyDeparture?: boolean;
  size?: "sm" | "lg";
}) {
  const icon = size === "lg" ? 20 : 16;
  return (
    <div className="flex flex-wrap gap-2">
      {presence === "atteso" && canArrive && (
        <ActionButton action={registerMovement} fields={{ contractId, kind: "arrivo" }} variant="primary" size={size}>
          <ArrowDownToLine size={icon} aria-hidden="true" />
          Registra arrivo
        </ActionButton>
      )}
      {presence === "in_porto" && (
        <ActionButton action={registerMovement} fields={{ contractId, kind: "uscita" }} variant="secondary" size={size}>
          <Waves size={icon} aria-hidden="true" />
          Uscita in mare
        </ActionButton>
      )}
      {presence === "fuori" && (
        <ActionButton action={registerMovement} fields={{ contractId, kind: "rientro" }} variant="primary" size={size}>
          <Undo2 size={icon} aria-hidden="true" />
          Registra rientro
        </ActionButton>
      )}
      {(presence === "in_porto" || presence === "fuori") && (departing || earlyDeparture) && (
        <ActionButton
          action={registerMovement}
          fields={{ contractId, kind: "partenza" }}
          variant={departing ? "accent" : "danger"}
          size={size}
          confirm={departing ? undefined : "La barca lascia il posto prima della scadenza: il contratto verrà chiuso a oggi e il posto tornerà libero. Confermi?"}
        >
          <ArrowUpFromLine size={icon} aria-hidden="true" />
          {departing ? "Registra partenza" : "Partenza anticipata"}
        </ActionButton>
      )}
    </div>
  );
}
