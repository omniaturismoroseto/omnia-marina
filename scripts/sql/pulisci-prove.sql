-- Pulizia dei dati di prova (tutti i porti), in una transazione sola: o va tutto o non cambia nulla.
-- Via: contratti annullati e conclusi (con voci e movimenti), scadenze e incassi che non sono dei contratti attivi,
-- tutta la prima nota tranne gli incassi dei contratti attivi, le importazioni da Excel.
-- Restano: bozze, contratti attivi con le loro rate e i loro incassi, clienti, barche, posti, listini e impostazioni.
\set ON_ERROR_STOP on
begin;
create temp table keep_charges on commit drop as
  select ch.id from charges ch join contracts c on c.id = ch.contract_id where c.status = 'attivo';
create temp table keep_payments on commit drop as
  select p.id from payments p where p.charge_id in (select id from keep_charges);

delete from ledger_entries where payment_id is null or payment_id not in (select id from keep_payments);
delete from ledger_imports;
delete from payments where id not in (select id from keep_payments);
update contract_items set charge_id = null where charge_id is not null and charge_id not in (select id from keep_charges);
delete from charges where id not in (select id from keep_charges);
delete from contracts where status in ('annullato', 'concluso');
commit;
\echo 'Pulizia fatta.'
