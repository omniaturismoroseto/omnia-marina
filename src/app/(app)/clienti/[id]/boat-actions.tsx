import { Repeat } from "lucide-react";
import { ActionButton } from "@/components/form";
import { ButtonLink } from "@/components/ui";
import { deleteBoat, setBoatArchivedAction } from "@/server/boat-actions";

/**
 * Azioni sulla barca dalla scheda cliente. Con un contratto attivo la barca non si archivia né si elimina: si passa da
 * «Cambia barca» (il contratto firmato si conclude e ne nasce uno nuovo). Si elimina solo una barca mai usata.
 */
export function BoatRowActions({
  boatId,
  boatName,
  archived,
  activeContractId,
  hasContracts,
}: {
  boatId: string;
  boatName: string;
  archived: boolean;
  activeContractId: string | null;
  hasContracts: boolean;
}) {
  if (activeContractId) {
    return (
      <ButtonLink href={`/contratti/${activeContractId}/cambia-barca`} size="sm" variant="ghost" title="Il cliente ha venduto la barca e ne porta un'altra">
        <Repeat size={14} aria-hidden="true" />
        Cambia barca
      </ButtonLink>
    );
  }
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      <ActionButton
        action={setBoatArchivedAction}
        fields={{ boatId, archived: archived ? "0" : "1" }}
        size="sm"
        variant="ghost"
        confirm={archived ? undefined : `Mettere ${boatName} in archivio? Esce dall'elenco delle barche e dalle scelte dei nuovi contratti.`}
      >
        {archived ? "Ripristina" : "Archivia"}
      </ActionButton>
      {!hasContracts && (
        <ActionButton action={deleteBoat} fields={{ boatId, ritorno: "cliente" }} size="sm" variant="ghost" confirm={`Eliminare definitivamente ${boatName}?`}>
          Elimina
        </ActionButton>
      )}
    </span>
  );
}
