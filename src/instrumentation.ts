// Eseguito una volta all'avvio del server, prima di accettare richieste.
export async function register() {
  // In produzione (immagine Docker, Cloud Run) il database si aggiorna da solo a ogni nuova versione:
  // basta AUTO_MIGRATE=true. Se una migrazione fallisce il server non parte e resta in servizio la versione precedente.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AUTO_MIGRATE === "true") {
    const { runMigrations } = await import("./db/migrate");
    await runMigrations();
    console.log("Database aggiornato all'ultima versione.");
  }
}
