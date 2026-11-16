"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { ActionButton } from "@/components/form";
import type { FormState } from "@/lib/forms";
import { Badge, Card } from "@/components/ui";
import { formatDimensions } from "@/lib/format";
import {
  BOAT_FIELDS,
  checkRow,
  cleanRow,
  displayNameOf,
  extractRawRows,
  FIELD_LABEL,
  findHeaderRow,
  groupRows,
  guessMapping,
  MAX_OWNER_IMPORT_ROWS,
  OWNER_FIELDS,
  sheetColumns,
  type ColumnInfo,
  type FieldKey,
  type ImportBoat,
  type ImportOwner,
  type Issue,
  type OwnerGroup,
  type ReviewedRow,
} from "@/lib/owner-import";
import { readXlsx, XlsxError, type Workbook } from "@/lib/xlsx";
import { importOwnersFile, matchExistingOwners, removeOwnerImport } from "@/server/owner-import-actions";

type Decision = "crea" | "completa" | "salta";
type Existing = { id: string; displayName: string; boatsCount: number; activeContract: boolean };
type Filter = "controllare" | "tutti" | "presenti" | "esclusi";

// Il foglio con più colonne riconosciute nell'intestazione.
function bestSheet(wb: Workbook): string {
  let best = wb.sheets[0]?.name ?? "";
  let score = -1;
  for (const s of wb.sheets) {
    const h = findHeaderRow(s);
    if (h === null) continue;
    const n = Object.values(guessMapping(sheetColumns(s, h))).filter(Boolean).length;
    if (n > score) {
      score = n;
      best = s.name;
    }
  }
  return best;
}

export function OwnerImporter({ today, formerLabel }: { today: string; formerLabel: string }) {
  const [file, setFile] = useState<{ name: string; workbook: Workbook } | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [headerSource, setHeaderSource] = useState("");
  const [mapping, setMapping] = useState<Record<number, FieldKey | null>>({});
  const [titleCase, setTitleCase] = useState(true);
  const [markFormer, setMarkFormer] = useState(false);
  const [rows, setRows] = useState<ReviewedRow[] | null>(null);
  const [existing, setExisting] = useState<Record<string, Existing>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [filter, setFilter] = useState<Filter>("controllare");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [state, dispatch, pending] = useActionState(importOwnersFile, undefined);
  // L'invio in corso: per quale foglio e qual era la risposta precedente, così non si mostra quella di un'importazione già fatta.
  const [submitted, setSubmitted] = useState<{ key: string; before: FormState } | null>(null);
  const answer = file && submitted && !pending && state !== submitted.before && submitted.key === `${file.name}:${sheetName}` ? state : undefined;

  const sheet = file?.workbook.sheets.find((s) => s.name === sheetName) ?? null;
  const headerIdx = sheet ? findHeaderRow(sheet) : null;
  const sheetsWithHeader = file?.workbook.sheets.filter((s) => findHeaderRow(s) !== null).map((s) => s.name) ?? [];

  // Colonne del foglio; un foglio senza intestazione può prenderla da un altro con le stesse colonne (es. RECESSI da «dati»).
  const columns: ColumnInfo[] = useMemo(() => {
    if (!sheet || !file) return [];
    const cols = sheetColumns(sheet, headerIdx);
    if (headerIdx !== null || !headerSource) return cols;
    const source = file.workbook.sheets.find((s) => s.name === headerSource);
    const srcHeader = source ? source.rows[findHeaderRow(source) ?? 0]?.cells ?? [] : [];
    return cols.map((c) => ({ ...c, header: typeof srcHeader[c.index] === "string" ? String(srcHeader[c.index]).trim() : "" }));
  }, [sheet, file, headerIdx, headerSource]);

  function chooseSheet(wb: Workbook, name: string) {
    setSheetName(name);
    const s = wb.sheets.find((x) => x.name === name);
    const h = s ? findHeaderRow(s) : null;
    const source = h === null ? (wb.sheets.find((x) => x.name !== name && findHeaderRow(x) !== null)?.name ?? "") : "";
    setHeaderSource(source);
    setMarkFormer(/recess|cessat|disdett|\bex\b/i.test(name));
    setRows(null);
    if (s) {
      let cols = sheetColumns(s, h);
      if (h === null && source) {
        const src = wb.sheets.find((x) => x.name === source)!;
        const srcHeader = src.rows[findHeaderRow(src) ?? 0]?.cells ?? [];
        cols = cols.map((c) => ({ ...c, header: typeof srcHeader[c.index] === "string" ? String(srcHeader[c.index]).trim() : "" }));
      }
      setMapping(guessMapping(cols));
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    setReading(true);
    try {
      const workbook = await readXlsx(await f.arrayBuffer());
      if (workbook.sheets.length === 0) throw new XlsxError("Il file non contiene fogli.");
      setFile({ name: f.name, workbook });
      chooseSheet(workbook, bestSheet(workbook));
      setSubmitted(null);
    } catch (err) {
      setFile(null);
      setError(err instanceof XlsxError ? err.message : "Non riesco a leggere il file: deve essere un Excel (.xlsx).");
    } finally {
      setReading(false);
    }
  }

  function analyze() {
    if (!sheet || !file) return;
    const raw = extractRawRows(sheet, headerIdx, mapping);
    if (raw.length > MAX_OWNER_IMPORT_ROWS) {
      setError(`Il foglio ha ${raw.length} righe: se ne possono importare al massimo ${MAX_OWNER_IMPORT_ROWS} per volta.`);
      return;
    }
    setError(null);
    setRows(raw.map((r) => cleanRow(r, { titleCase, date1904: file.workbook.date1904 }, today)));
    setDecisions({});
    setFilter("controllare");
  }

  const groups = useMemo(() => (rows ? groupRows(rows) : []), [rows]);
  const issuesByRow = useMemo(() => new Map((rows ?? []).map((r) => [r.row, checkRow(r)])), [rows]);

  // Clienti già presenti nel porto: si richiedono quando cambiano i clienti del file.
  const queryKey = groups.map((g) => g.key).join("|");
  useEffect(() => {
    if (groups.length === 0) return;
    let stale = false;
    const queries = groups.map((g) => ({ key: g.key, fiscalCode: g.owner.fiscalCode, vatNumber: g.owner.vatNumber, name: displayNameOf(g.owner) }));
    matchExistingOwners(queries)
      .then((found) => !stale && setExisting(found))
      .catch(() => !stale && setExisting({}));
    return () => {
      stale = true;
    };
    // groups cambia identità a ogni modifica; basta la lista delle chiavi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  function updateRow(row: number, patch: { owner?: Partial<ImportOwner>; boat?: Partial<ImportBoat>; excluded?: boolean }) {
    setRows((list) =>
      (list ?? []).map((r) =>
        r.row !== row ? r : { ...r, excluded: patch.excluded ?? r.excluded, owner: { ...r.owner, ...patch.owner }, boat: r.boat && patch.boat ? { ...r.boat, ...patch.boat } : r.boat },
      ),
    );
  }

  // ── Scelta del file ──
  if (!file) {
    return (
      <Card>
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-10 text-center hover:border-sea">
          <Upload size={28} aria-hidden="true" className="text-sea" />
          <span className="font-medium text-ink">{reading ? "Lettura del file…" : "Scegli il file Excel con i clienti"}</span>
          <span className="text-sm text-muted">Formato .xlsx. Va bene anche un foglio con contratti e barche: si prendono solo le colonne di clienti e barche.</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={reading} onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <p className="mt-4 text-sm text-muted">Il file viene letto qui nel browser: al server arrivano solo i clienti che confermi.</p>
      </Card>
    );
  }

  // ── Fatto ──
  if (answer?.ok) {
    return (
      <Card>
        <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          {answer.message}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/clienti" className="btn btn-primary">
            Vai ai clienti
          </Link>
          {file.workbook.sheets.length > 1 && (
            <button type="button" className="btn btn-secondary" onClick={() => {
                setSubmitted(null);
                setRows(null);
              }}>
              Importa un altro foglio dello stesso file
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setFile(null)}>
            Importa un altro file
          </button>
        </div>
      </Card>
    );
  }

  const mappedFields = new Set(Object.values(mapping).filter(Boolean));
  const hasName = ["fullName", "lastName", "companyName"].some((k) => mappedFields.has(k as FieldKey));

  return (
    <div className="space-y-5">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <FileSpreadsheet size={18} aria-hidden="true" className="text-sea" />
            {file.name}
          </span>
        }
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>
            Cambia file
          </button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="imp-sheet">
              Foglio
            </label>
            <select id="imp-sheet" className="input" value={sheetName} onChange={(e) => chooseSheet(file.workbook, e.target.value)}>
              {file.workbook.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.rows.length} righe)
                </option>
              ))}
            </select>
          </div>
          {headerIdx === null && (
            <div>
              <label className="label" htmlFor="imp-header">
                Il foglio non ha intestazioni: usa quelle del foglio
              </label>
              <select
                id="imp-header"
                className="input"
                value={headerSource}
                onChange={(e) => {
                  setHeaderSource(e.target.value);
                  setRows(null);
                  const src = file.workbook.sheets.find((x) => x.name === e.target.value);
                  const srcHeader = src ? src.rows[findHeaderRow(src) ?? 0]?.cells ?? [] : [];
                  setMapping(guessMapping(sheetColumns(sheet!, null).map((c) => ({ ...c, header: typeof srcHeader[c.index] === "string" ? String(srcHeader[c.index]).trim() : "" }))));
                }}
              >
                <option value="">Nessuno: scelgo le colonne a mano</option>
                {sheetsWithHeader.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {/* ── Colonne ── */}
      <details className="card" open={!rows}>
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-ink">
          Colonne del foglio · {mappedFields.size} riconosciute su {columns.length}
        </summary>
        <div className="border-t border-line-soft">
          <p className="px-4 pt-3 text-sm text-muted">Controlla a quale campo della scheda corrisponde ogni colonna. Le colonne su «Non importare» (contratti, importi…) vengono ignorate.</p>
          <div className="max-h-[28rem] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Colonna</th>
                  <th>Intestazione</th>
                  <th>Esempi</th>
                  <th>Campo della scheda</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.index}>
                    <td className="font-medium tabular-nums">{c.letter}</td>
                    <td>{c.header || <span className="text-faint">—</span>}</td>
                    <td className="max-w-[16rem] truncate text-xs text-muted" title={c.samples.join(" · ")}>
                      {c.samples.join(" · ")}
                    </td>
                    <td>
                      <select
                        className="input py-1"
                        aria-label={`Campo per la colonna ${c.letter}`}
                        value={mapping[c.index] ?? ""}
                        onChange={(e) => {
                          setRows(null);
                          setMapping((m) => ({ ...m, [c.index]: (e.target.value || null) as FieldKey | null }));
                        }}
                      >
                        <option value="">Non importare</option>
                        <optgroup label="Cliente">
                          {OWNER_FIELDS.map((k) => (
                            <option key={k} value={k} disabled={mapping[c.index] !== k && mappedFields.has(k)}>
                              {FIELD_LABEL[k]}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Barca">
                          {BOAT_FIELDS.map((k) => (
                            <option key={k} value={k} disabled={mapping[c.index] !== k && mappedFields.has(k)}>
                              {FIELD_LABEL[k]}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-line-soft p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={titleCase} onChange={(e) => (setTitleCase(e.target.checked), setRows(null))} />
              Nomi, luoghi e indirizzi scritti TUTTO MAIUSCOLO diventano «Rossi Mario»
            </label>
            <button type="button" className="btn btn-primary" disabled={!hasName} onClick={analyze}>
              {rows ? "Analizza di nuovo" : "Analizza le righe"}
            </button>
            {!hasName && <span className="text-sm text-warn">Serve almeno una colonna con il nome del cliente (cognome e nome, oppure ragione sociale).</span>}
          </div>
        </div>
      </details>

      {error && (
        <p role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {rows && (
        <Review
          rows={rows}
          groups={groups}
          issuesByRow={issuesByRow}
          existing={existing}
          decisions={decisions}
          setDecision={(key, d) => setDecisions((m) => ({ ...m, [key]: d }))}
          filter={filter}
          setFilter={setFilter}
          markFormer={markFormer}
          setMarkFormer={setMarkFormer}
          formerLabel={formerLabel}
          updateRow={updateRow}
          pending={pending}
          serverMessage={answer && !answer.ok ? answer.message : undefined}
          onSubmit={() => {
            const data = new FormData();
            data.set("payload", JSON.stringify({ fileName: file.name, sheetName, markFormer, decisions, rows: rows.map(({ fixes: _f, ...r }) => r) }));
            setSubmitted({ key: `${file.name}:${sheetName}`, before: state });
            startTransition(() => dispatch(data));
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── Revisione ─────────────────────────

function Review({
  rows,
  groups,
  issuesByRow,
  existing,
  decisions,
  setDecision,
  filter,
  setFilter,
  markFormer,
  setMarkFormer,
  formerLabel,
  updateRow,
  pending,
  serverMessage,
  onSubmit,
}: {
  rows: ReviewedRow[];
  groups: OwnerGroup[];
  issuesByRow: Map<number, Issue[]>;
  existing: Record<string, Existing>;
  decisions: Record<string, Decision>;
  setDecision: (key: string, d: Decision) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  markFormer: boolean;
  setMarkFormer: (v: boolean) => void;
  formerLabel: string;
  updateRow: (row: number, patch: { owner?: Partial<ImportOwner>; boat?: Partial<ImportBoat>; excluded?: boolean }) => void;
  pending: boolean;
  serverMessage?: string;
  onSubmit: () => void;
}) {
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const blocked = rows.filter((r) => !r.excluded && (issuesByRow.get(r.row) ?? []).some((i) => i.level === "blocca"));
  const excluded = rows.filter((r) => r.excluded);
  const decisionOf = (g: OwnerGroup): Decision => decisions[g.key] ?? (existing[g.key] ? "completa" : "crea");
  const groupIssues = (g: OwnerGroup) => g.rows.flatMap((n) => issuesByRow.get(n) ?? []);
  const groupFixes = (g: OwnerGroup) => g.rows.flatMap((n) => byRow.get(n)?.fixes ?? []);
  const needsCheck = (g: OwnerGroup) => groupIssues(g).length > 0 || groupFixes(g).length > 0 || g.conflicts.length > 0 || g.rows.length > 1 || Boolean(existing[g.key]);

  const toCreate = groups.filter((g) => decisionOf(g) !== "salta");
  const boatsReady = toCreate.flatMap((g) => g.boats).filter(({ boat }) => boat.lengthCm && boat.beamCm).length;
  const boatsMissing = toCreate.flatMap((g) => g.boats).length - boatsReady;
  const counts = {
    controllare: groups.filter(needsCheck).length + blocked.length,
    tutti: groups.length,
    presenti: groups.filter((g) => existing[g.key]).length,
    esclusi: excluded.length,
  };
  const shownGroups = filter === "esclusi" ? [] : groups.filter((g) => (filter === "tutti" ? true : filter === "presenti" ? Boolean(existing[g.key]) : needsCheck(g)));
  const warnings = groups.reduce((s, g) => s + groupIssues(g).length, 0);
  const merged = groups.filter((g) => g.rows.length > 1).length;

  return (
    <>
      <Card title="Riepilogo">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Summary label="Righe lette" value={String(rows.length)} hint={excluded.length ? `${excluded.length} escluse` : undefined} />
          <Summary label="Clienti" value={String(groups.length)} hint={merged ? `${merged} su più righe (uniti)` : undefined} />
          <Summary label="Già nell'app" value={String(counts.presenti)} hint="si completano solo i campi vuoti" />
          <Summary label="Barche da creare" value={String(boatsReady)} hint={boatsMissing ? `${boatsMissing} senza misure: non create` : undefined} />
          <Summary label="Avvisi" value={String(warnings)} />
          <Summary label="Da sistemare" value={String(blocked.length)} hint={blocked.length ? "righe senza nome" : undefined} />
        </dl>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={markFormer} onChange={(e) => setMarkFormer(e.target.checked)} />
          <span>
            Metti tutti i clienti di questo foglio nella categoria <strong>«{formerLabel}»</strong> (per esempio un foglio di recessi o disdette). Chi ha già un contratto
            attivo nell&apos;app non viene spostato.
          </span>
        </label>
        <p className="hint mt-2">Le barche senza nome prendono il nome da cantiere e modello. I campi già compilati dei clienti presenti nell&apos;app non vengono mai sovrascritti.</p>
      </Card>

      {blocked.length > 0 && (
        <Card title={`Righe da sistemare (${blocked.length})`}>
          <p className="mb-3 text-sm text-muted">Manca il nome del cliente: scrivilo oppure escludi la riga.</p>
          <ul className="space-y-3">
            {blocked.map((r) => (
              <li key={r.row}>
                <RowEditor row={r} issues={issuesByRow.get(r.row) ?? []} updateRow={updateRow} open />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Clienti del file"
        actions={
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtra i clienti">
            {(
              [
                ["controllare", "Da controllare"],
                ["tutti", "Tutti"],
                ["presenti", "Già nell'app"],
                ["esclusi", "Righe escluse"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(key)}>
                {label} ({counts[key]})
              </button>
            ))}
          </div>
        }
        flush
      >
        {filter === "esclusi" ? (
          excluded.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Nessuna riga esclusa.</p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {excluded.map((r) => (
                <li key={r.row} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span>
                    Riga {r.row} · {displayNameOf(r.owner) || "senza nome"}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateRow(r.row, { excluded: false })}>
                    <RotateCcw size={14} aria-hidden="true" /> Includi di nuovo
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : shownGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nessun cliente in questo elenco.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {shownGroups.map((g) => (
              <GroupItem
                key={g.key}
                group={g}
                rows={g.rows.map((n) => byRow.get(n)!)}
                issuesByRow={issuesByRow}
                existing={existing[g.key]}
                decision={decisionOf(g)}
                setDecision={(d) => setDecision(g.key, d)}
                updateRow={updateRow}
              />
            ))}
          </ul>
        )}
      </Card>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <button type="button" className="btn btn-primary" disabled={pending || blocked.length > 0 || toCreate.length === 0} onClick={onSubmit}>
          {pending ? "Importazione in corso…" : `Importa ${toCreate.length === 1 ? "1 cliente" : `${toCreate.length} clienti`} e ${boatsReady === 1 ? "1 barca" : `${boatsReady} barche`}`}
        </button>
        {blocked.length > 0 ? (
          <span className="text-sm text-warn">Prima sistema o escludi le righe senza nome.</span>
        ) : (
          <span className="text-sm text-muted">Potrai annullare l&apos;importazione dall&apos;elenco qui sotto.</span>
        )}
        {serverMessage && (
          <p role="alert" className="basis-full rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {serverMessage}
          </p>
        )}
      </div>
    </>
  );
}

function GroupItem({
  group,
  rows,
  issuesByRow,
  existing,
  decision,
  setDecision,
  updateRow,
}: {
  group: OwnerGroup;
  rows: ReviewedRow[];
  issuesByRow: Map<number, Issue[]>;
  existing?: Existing;
  decision: Decision;
  setDecision: (d: Decision) => void;
  updateRow: (row: number, patch: { owner?: Partial<ImportOwner>; boat?: Partial<ImportBoat>; excluded?: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const o = group.owner;
  const issues = group.rows.flatMap((n) => (issuesByRow.get(n) ?? []).map((i) => ({ ...i, row: n })));
  const fixes = rows.flatMap((r) => r.fixes.map((f) => ({ f, row: r.row })));
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {displayNameOf(o)}
            <span className="ml-2 text-xs font-normal text-muted">
              {group.rows.length > 1 ? `righe ${group.rows.join(", ")}` : `riga ${group.rows[0]}`}
              {o.type === "azienda" ? " · azienda" : ""}
            </span>
          </p>
          <p className="text-sm text-muted">{[o.fiscalCode || o.vatNumber, [o.city, o.province].filter(Boolean).join(" "), o.phone, o.email].filter(Boolean).join(" · ") || "—"}</p>
          {group.boats.length > 0 && (
            <p className="mt-0.5 text-sm">
              {group.boats.map(({ boat, row }) => (
                <span key={row} className="mr-3 inline-block">
                  ⛵ {boat.name}{" "}
                  {boat.lengthCm && boat.beamCm ? <span className="text-muted">{formatDimensions(boat.lengthCm, boat.beamCm)}</span> : <span className="text-warn">misure mancanti</span>}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {existing ? <Badge tone="sea">Già nell&apos;app</Badge> : <Badge tone="ok">Nuovo</Badge>}
          {!existing && (
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={decision === "salta"} onChange={(e) => setDecision(e.target.checked ? "salta" : "crea")} /> Salta
            </label>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Chiudi" : "Modifica"}
          </button>
        </div>
      </div>
      {existing && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-sea-soft/60 px-3 py-2 text-sm">
          <span>
            Nell&apos;app c&apos;è già <strong>{existing.displayName}</strong>
            {` · ${existing.boatsCount === 1 ? "1 barca" : `${existing.boatsCount} barche`}`}
            {existing.activeContract ? " · contratto attivo" : ""}
          </span>
          <select className="input w-auto py-1 text-sm" aria-label={`Cosa fare con ${displayNameOf(o)}`} value={decision} onChange={(e) => setDecision(e.target.value as Decision)}>
            <option value="completa">Completa la scheda esistente</option>
            <option value="crea">Crea un cliente nuovo</option>
            <option value="salta">Salta</option>
          </select>
          <span className="text-xs text-muted">
            {decision === "completa"
              ? "Si riempiono solo i campi vuoti e si aggiungono le barche nuove."
              : decision === "crea"
                ? "Attenzione: avrai due schede per la stessa persona."
                : "Questo cliente non viene importato."}
          </span>
        </div>
      )}
      {(issues.length > 0 || fixes.length > 0 || group.conflicts.length > 0) && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {issues.map((i, n) => (
            <li key={`i${n}`} className={i.level === "blocca" ? "text-bad" : "text-warn"}>
              ⚠ {group.rows.length > 1 ? `Riga ${i.row}: ` : ""}
              {i.message}
            </li>
          ))}
          {group.conflicts.map((c, n) => (
            <li key={`c${n}`} className="text-warn">
              ⚠ {c}
            </li>
          ))}
          {fixes.map((x, n) => (
            <li key={`f${n}`} className="text-muted">
              ✓ {group.rows.length > 1 ? `Riga ${x.row}: ` : ""}
              {x.f}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="mt-3 space-y-3">
          {rows.map((r) => (
            <RowEditor key={r.row} row={r} issues={issuesByRow.get(r.row) ?? []} updateRow={updateRow} />
          ))}
        </div>
      )}
    </li>
  );
}

// Modifica a mano dei campi principali di una riga, oppure esclusione della riga.
function RowEditor({
  row,
  issues,
  updateRow,
  open = true,
}: {
  row: ReviewedRow;
  issues: Issue[];
  updateRow: (row: number, patch: { owner?: Partial<ImportOwner>; boat?: Partial<ImportBoat>; excluded?: boolean }) => void;
  open?: boolean;
}) {
  const o = row.owner;
  const field = (key: keyof ImportOwner, label: string, width = "") => (
    <label className={`block ${width}`}>
      <span className="label">{label}</span>
      <input className="input py-1" value={o[key]} onChange={(e) => updateRow(row.row, { owner: { [key]: e.target.value } })} />
    </label>
  );
  const cm = (key: "lengthCm" | "beamCm" | "draftCm", label: string) => (
    <label className="block">
      <span className="label">{label} (cm)</span>
      <input
        className="input py-1"
        inputMode="numeric"
        value={row.boat?.[key] ?? ""}
        onChange={(e) => updateRow(row.row, { boat: { [key]: e.target.value === "" ? null : Math.max(0, Math.round(Number(e.target.value.replace(",", "."))) || 0) || null } })}
      />
    </label>
  );
  if (!open) return null;
  return (
    <div className="rounded-md border border-line-soft bg-paper p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">Riga {row.row}</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={row.excluded} onChange={(e) => updateRow(row.row, { excluded: e.target.checked })} /> Escludi questa riga
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="label">Tipo</span>
          <select className="input py-1" value={o.type} onChange={(e) => updateRow(row.row, { owner: { type: e.target.value as ImportOwner["type"] } })}>
            <option value="persona">Persona fisica</option>
            <option value="azienda">Azienda o ente</option>
          </select>
        </label>
        {o.type === "azienda" ? field("companyName", "Ragione sociale", "col-span-3") : (
          <>
            {field("lastName", "Cognome")}
            {field("firstName", "Nome", "col-span-2")}
          </>
        )}
        {field("fiscalCode", "Codice fiscale")}
        {field("vatNumber", "Partita IVA")}
        {field("phone", "Telefono")}
        {field("email", "Email")}
        {field("city", "Comune")}
        {field("province", "Provincia")}
      </div>
      {row.boat && (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <label className="block">
            <span className="label">Nome barca</span>
            <input className="input py-1" value={row.boat.name} onChange={(e) => updateRow(row.row, { boat: { name: e.target.value } })} />
          </label>
          {cm("lengthCm", "Lunghezza")}
          {cm("beamCm", "Larghezza")}
          {cm("draftCm", "Pescaggio")}
        </div>
      )}
      {issues.length > 0 && <p className="mt-2 text-xs text-warn">{issues.map((i) => i.message).join(" ")}</p>}
    </div>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="text-lg font-semibold text-ink tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

export function UndoOwnerImportButton({ importId }: { importId: string }) {
  return (
    <ActionButton
      action={removeOwnerImport}
      fields={{ importId }}
      variant="ghost"
      size="sm"
      confirm="Annullare l'importazione? Vengono cancellati i clienti e le barche creati, tranne quelli già usati in contratti, addebiti o consensi. I campi completati su clienti già presenti restano."
    >
      Annulla importazione
    </ActionButton>
  );
}

