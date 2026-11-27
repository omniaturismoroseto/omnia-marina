-- Anteprima della pulizia dei dati di prova: conta che cosa si cancella e che cosa resta, porto per porto. Non cambia nulla.
\pset footer off
with keep as (
  select ch.id from charges ch join contracts c on c.id = ch.contract_id where c.status = 'attivo'
), keep_pay as (
  select p.id from payments p where p.charge_id in (select id from keep)
)
select
  m.name as porto,
  (select count(*) from contracts c where c.marina_id = m.id and c.status in ('annullato', 'concluso')) as "contratti annullati/conclusi (via)",
  (select count(*) from contracts c where c.marina_id = m.id and c.status = 'attivo') as "attivi (restano)",
  (select count(*) from contracts c where c.marina_id = m.id and c.status = 'bozza') as "bozze (restano)",
  (select count(*) from charges ch where ch.marina_id = m.id and ch.id not in (select id from keep)) as "scadenze (via)",
  (select count(*) from charges ch where ch.marina_id = m.id and ch.id in (select id from keep)) as "scadenze attivi (restano)",
  (select count(*) from payments p where p.marina_id = m.id and p.id not in (select id from keep_pay)) as "incassi (via)",
  (select count(*) from ledger_entries l where l.marina_id = m.id and (l.payment_id is null or l.payment_id not in (select id from keep_pay))) as "prima nota (via)",
  (select count(*) from ledger_entries l where l.marina_id = m.id and l.payment_id in (select id from keep_pay)) as "prima nota attivi (restano)"
from marinas m
order by m.name;
