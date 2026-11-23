import "server-only";
import { asc, sql, type SQL } from "drizzle-orm";
import { berths } from "@/db/schema";

/**
 * Ordine «naturale» dei codici dei posti nelle query: prima le lettere, poi il numero come numero (A2 prima di A10), come
 * compareCodes in src/lib/berth-codes.ts. Serve perché i numeri da 1 a 9 non hanno lo zero davanti.
 */
export const byBerthCode: SQL[] = [
  sql`substring(${berths.code} from '^[^0-9]*')`,
  sql`nullif(substring(${berths.code} from '[0-9]+$'), '')::numeric nulls first`,
  asc(berths.code),
];
