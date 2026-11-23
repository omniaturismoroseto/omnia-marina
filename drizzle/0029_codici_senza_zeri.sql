-- I numeri da 1 a 9 dei codici dei posti non hanno lo zero davanti: A01 → A1, CN07 → CN7 (A10 resta A10).
-- Se nello stesso porto il codice senza zero esiste già, quel posto resta com'è (il codice è unico per porto).
UPDATE "berths" AS b
SET "code" = regexp_replace(b."code", '^(.*[^0-9])0([1-9])$', '\1\2')
WHERE b."code" ~ '^.*[^0-9]0[1-9]$'
  AND NOT EXISTS (
    SELECT 1 FROM "berths" AS o
    WHERE o."marina_id" = b."marina_id"
      AND o."code" = regexp_replace(b."code", '^(.*[^0-9])0([1-9])$', '\1\2')
  );
