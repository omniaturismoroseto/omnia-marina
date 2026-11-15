"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState } from "react";
import { FileSpreadsheet, RotateCcw } from "lucide-react";
import { ActionButton } from "@/components/form";
import { Badge, Card, Notice } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { LEDGER_TECHNICAL_CATEGORIES } from "@/lib/labels";
import {
  checkRows,
  extractLedgerRows,
  hasBlockingIssues,
  reviewRows,
  sheetCashBalance,
  toLedgerEntries,
  type DraftRow,
  type Extracted,
  type Issue,
  type ReviewedRow,
  type SourceRow,
} from "@/lib/ledger-import";
import { readXlsx, XlsxError } from "@/lib/xlsx";
import { importLedgerFile, removeLedgerImport } from "@/server/ledger-import-actions";

type Loaded = {
  fileName: string;
  fileHash: string;
  extracted: Omit<Extracted, "rows">;
  reviewed: ReviewedRow[];
};

type Filter = "controllare" | "tutte" | "escluse";

const TECHNICAL = LEDGER_TECHNICAL_CATEGORIES as readonly string[];

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function LedgerImporter({ today, existingByMonth }: { today: string; existingByMonth: Record<string, number> }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [filter, setFilter] = useState<Filter>("controllare");
  const [state, dispatch, pending] = useActionState(importLedgerFile, undefined);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setReading(true);
    try {
      const buffer = await file.arrayBuffer();
      const { rows, ...extracted } = extractLedgerRows(await readXlsx(buffer));
      const reviewed = reviewRows(rows);
      setLoaded({ fileName: file.name, fileHash: await sha256(buffer), extracted, reviewed });
      setDrafts(reviewed.map((r) => r.proposed));
      setFilter("controllare");
      setDoneFor(null);
    } catch (err) {
      setLoaded(null);
      setError(err instanceof XlsxError ? err.message : "Non riesco a leggere il file: deve essere un Excel (.xlsx).");
    } finally {
      setReading(false);
    }
  }

  const issues = useMemo(() => checkRows(drafts, today), [drafts, today]);
  const entries = useMemo(() => toLedgerEntries(drafts), [drafts]);
  const blocking = hasBlockingIssues(issues);

  const byRow = useMemo(() => new Map(loaded?.reviewed.map((r) => [r.original.row, r]) ?? []), [loaded]);

  function update(row: number, patch: Partial<DraftRow>) {
    setDrafts((list) => list.map((d) => (d.row === row ? { ...d, ...patch } : d)));
  }
  function restore(row: number) {
    const original = byRow.get(row)?.original;
    if (original) update(row, { ...original, excluded: original.amountCents === null && original.bankCents === null });
  }

  if (!loaded) {
    return (
      <Card>
        <FilePicker onFile={onFile} reading={reading} />
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}
        <div className="mt-4 space-y-1 text-sm text-muted">
          <p>Il foglio deve avere le colonne della prima nota: Data operazione, Causale, pagamento, note, n., anno, Cliente, Fornitore, Entrate uscite, banca.</p>
          <p>Il file viene letto qui nel browser: al server arrivano solo i movimenti che confermi.</p>
        </div>
      </Card>
    );
  }

  if (state?.ok && doneFor === loaded.fileHash) {
    return (
      <Card>
        <p role="status" className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          {state.message}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/contabilita/prima-nota?mese=${entries[0]?.entryDate.slice(0, 7) ?? ""}`} className="btn btn-primary">
            Vai alla prima nota
          </Link>
          <Link href="/contabilita/riepilogo" className="btn btn-secondary">
            Vedi il riepilogo
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => setLoaded(null)}>
            Importa un altro file
          </button>
        </div>
      </Card>
    );
  }

  const included = drafts.filter((d) => !d.excluded);
  const dates = included.map((d) => d.date).filter((d): d is string => Boolean(d)).sort();
  const originalCash = sheetCashBalance(loaded.reviewed.map((r) => ({ ...r.original, excluded: false })));
  const cash = sheetCashBalance(drafts);
  const bank = entries.filter((e) => e.account === "banca").reduce((s, e) => s + (e.direction === "entrata" ? e.amountCents : -e.amountCents), 0);
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const overlapping = months.reduce((s, m) => s + (existingByMonth[m] ?? 0), 0);

  const totalsBy = (direction: "entrata" | "uscita") => {
    const map = new Map<string, number>();
    for (const e of entries) if (e.direction === direction && !TECHNICAL.includes(e.category)) map.set(e.category, (map.get(e.category) ?? 0) + e.amountCents);
    return [...map].sort((a, b) => b[1] - a[1]);
  };

  const needsCheck = (d: DraftRow) => {
    const r = byRow.get(d.row);
    return (issues.get(d.row)?.length ?? 0) > 0 || (r?.fixes.length ?? 0) > 0 || (r?.suggestions.length ?? 0) > 0 || d.excluded;
  };
  const counts = { controllare: drafts.filter(needsCheck).length, tutte: drafts.length, escluse: drafts.filter((d) => d.excluded).length };
  const shown = drafts.filter((d) => (filter === "tutte" ? true : filter === "escluse" ? d.excluded : needsCheck(d)));
  const warnings = [...issues.values()].flat().filter((i) => i.level === "avviso").length;

  function submit() {
    const data = new FormData();
    data.set("payload", JSON.stringify({ fileName: loaded!.fileName, fileHash: loaded!.fileHash, sheetName: loaded!.extracted.sheetName, rows: drafts }));
    setDoneFor(loaded!.fileHash);
    startTransition(() => dispatch(data));
  }

  return (
    <div className="space-y-5">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <FileSpreadsheet size={18} aria-hidden="true" className="text-sea" />
            {loaded.fileName} · foglio “{loaded.extracted.sheetName}”
          </span>
        }
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLoaded(null)}>
            Cambia file
          </button>
        }
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Summary label="Righe da importare" value={`${included.length} di ${drafts.length}`} />
          <Summary label="Periodo" value={dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : "—"} />
          <Summary label="Movimenti che verranno creati" value={String(entries.length)} />
          <Summary label="Saldo cassa finale" value={formatMoney(cash)} hint={cash !== originalCash ? `nel file ${formatMoney(originalCash)}` : "uguale al file"} />
          <Summary label="Entrate in banca" value={formatMoney(bank)} hint="il foglio non registra le uscite di banca" />
          <Summary label="Da controllare" value={String(counts.controllare)} hint={warnings ? `${warnings} avvisi` : undefined} />
        </dl>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <CategoryList title="Entrate" rows={totalsBy("entrata")} />
          <CategoryList title="Uscite" rows={totalsBy("uscita")} />
        </div>
        <p className="hint mt-3">
          Il carburante diventa un movimento al giorno: in cassa il venduto meno POS, sospesi e uso interno, in banca il POS. I versamenti “BANCA” diventano un giroconto
          dalla cassa alla banca, che non conta tra entrate e uscite.
        </p>
      </Card>

      {overlapping > 0 && (
        <Notice tone="warn">
          Nei mesi coperti dal file l&apos;app ha già {overlapping} movimenti registrati (incassi dalle schede clienti o movimenti a mano). Se sono gli stessi del file,
          importando li conteresti due volte.
        </Notice>
      )}
      {(loaded.extracted.ignoredRows.length > 0 || loaded.extracted.invalidCells.length > 0) && (
        <Notice tone="sea">
          {loaded.extracted.ignoredRows.length > 0 && (
            <span className="block">Righe senza data né causale, non importate (totali o appunti): {loaded.extracted.ignoredRows.join(", ")}.</span>
          )}
          {loaded.extracted.invalidCells.map((c) => (
            <span key={`${c.row}-${c.column}`} className="block">
              Riga {c.row}: nella colonna {c.column} c&apos;è “{c.value}”, che non è un importo: è stato ignorato.
            </span>
          ))}
        </Notice>
      )}

      <Card
        title="Righe del foglio"
        actions={
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtra le righe">
            {(
              [
                ["controllare", "Da controllare"],
                ["tutte", "Tutte"],
                ["escluse", "Escluse"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setFilter(key)}
              >
                {label} ({counts[key]})
              </button>
            ))}
          </div>
        }
        flush
      >
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nessuna riga in questo elenco.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Riga</th>
                <th>Includi</th>
                <th>Data</th>
                <th>Movimento</th>
                <th className="num">Importo</th>
                <th className="num">Banca</th>
                <th>Controlli</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <RowEditor
                  key={d.row}
                  draft={d}
                  review={byRow.get(d.row)}
                  issues={issues.get(d.row) ?? []}
                  onChange={(patch) => update(d.row, patch)}
                  onRestore={() => restore(d.row)}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <details className="card">
        <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-ink">Vedi i {entries.length} movimenti che verranno creati</summary>
        <div className="max-h-[32rem] overflow-auto border-t border-line-soft">
          <table className="tbl">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrizione</th>
                <th>Categoria</th>
                <th>Conto</th>
                <th className="num">Entrata</th>
                <th className="num">Uscita</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap tabular-nums">{formatDate(e.entryDate)}</td>
                  <td>
                    {e.description}
                    {(e.counterparty || e.documentRef) && <span className="block text-xs text-muted">{[e.counterparty, e.documentRef].filter(Boolean).join(" · ")}</span>}
                  </td>
                  <td>{e.category}</td>
                  <td>{e.account === "cassa" ? "Cassa" : "Banca"}</td>
                  <td className="num">{e.direction === "entrata" ? formatMoney(e.amountCents) : ""}</td>
                  <td className="num">{e.direction === "uscita" ? formatMoney(e.amountCents) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <button type="button" className="btn btn-primary" disabled={pending || blocking || entries.length === 0} onClick={submit}>
          {pending ? "Importazione in corso…" : `Importa ${entries.length} movimenti`}
        </button>
        {blocking ? (
          <span className="text-sm text-bad">Ci sono righe da sistemare (data mancante o importo vuoto): correggile o escludile.</span>
        ) : (
          <span className="text-sm text-muted">Gli avvisi non bloccano l&apos;importazione. Se serve, potrai annullarla in un colpo solo.</span>
        )}
        {state?.message && !state.ok && (
          <p role="alert" className="w-full rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}

function FilePicker({ onFile, reading }: { onFile: (f: File | undefined) => void; reading: boolean }) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line px-4 py-10 text-center hover:border-sea">
      <FileSpreadsheet size={32} aria-hidden="true" className="text-sea" />
      <span className="font-medium text-ink">{reading ? "Lettura del file…" : "Scegli il file Excel della prima nota"}</span>
      <span className="text-sm text-muted">Formato .xlsx</span>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        disabled={reading}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function Summary({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold text-ink tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

function CategoryList({ title, rows }: { title: string; rows: [string, number][] }) {
  const total = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-ink">
        {title} · {formatMoney(total)}
      </h3>
      <ul className="text-sm">
        {rows.map(([category, cents]) => (
          <li key={category} className="flex justify-between border-b border-line-soft py-1">
            <span>{category}</span>
            <span className="tabular-nums">{formatMoney(cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Campo importo con segno: si modifica liberamente e si legge quando si esce dal campo.
function MoneyCell({ value, label, onChange }: { value: number | null; label: string; onChange: (cents: number | null) => void }) {
  return (
    <input
      key={value ?? "vuoto"}
      defaultValue={moneyInput(value)}
      inputMode="decimal"
      aria-label={label}
      className="input w-24 text-right tabular-nums"
      onBlur={(e) => {
        const text = e.target.value.trim();
        if (text === "") return onChange(null);
        const cents = parseMoney(text.replace("−", "-"));
        if (cents === null) e.target.value = moneyInput(value);
        else if (cents !== value) onChange(cents);
      }}
    />
  );
}

function RowEditor({
  draft: d,
  review,
  issues,
  onChange,
  onRestore,
}: {
  draft: DraftRow;
  review: ReviewedRow | undefined;
  issues: Issue[];
  onChange: (patch: Partial<DraftRow>) => void;
  onRestore: () => void;
}) {
  const changed = review ? (Object.keys(review.original) as (keyof SourceRow)[]).some((k) => review.original[k] !== d[k]) : false;
  const pending = review?.suggestions.filter((s) => (Object.keys(s.patch) as (keyof SourceRow)[]).some((k) => s.patch[k] !== d[k])) ?? [];
  return (
    <tr className={d.excluded ? "opacity-60" : undefined}>
      <td className="tabular-nums text-muted">{d.row}</td>
      <td>
        <input
          type="checkbox"
          checked={!d.excluded}
          aria-label={`Includi la riga ${d.row}`}
          className="size-[18px] accent-sea"
          onChange={(e) => onChange({ excluded: !e.target.checked })}
        />
      </td>
      <td>
        <input
          type="date"
          value={d.date ?? ""}
          aria-label={`Data della riga ${d.row}`}
          className="input w-36"
          onChange={(e) => onChange({ date: e.target.value || null })}
        />
      </td>
      <td className="min-w-40">
        <span className="font-medium">{d.causale || "—"}</span>
        {d.name && <span> · {d.name}</span>}
        <span className="block text-xs text-muted">{[d.method, d.note, d.year && `anno ${d.year}`, d.receipt && `ric. ${d.receipt}`].filter(Boolean).join(" · ")}</span>
      </td>
      <td className="num">
        <MoneyCell value={d.amountCents} label={`Importo della riga ${d.row}`} onChange={(amountCents) => onChange({ amountCents })} />
      </td>
      <td className="num">
        <MoneyCell value={d.bankCents} label={`Banca della riga ${d.row}`} onChange={(bankCents) => onChange({ bankCents })} />
      </td>
      <td className="min-w-56">
        <div className="flex flex-col items-start gap-1">
          {review?.fixes.map((f) => (
            <Badge key={f} tone="ok">
              {f}
            </Badge>
          ))}
          {issues.map((i) => (
            <Badge key={i.message} tone={i.level === "blocca" ? "bad" : "warn"}>
              {i.message}
            </Badge>
          ))}
          {d.excluded && review?.original.amountCents === null && review.original.bankCents === null && <Badge>Senza importo: esclusa</Badge>}
          {pending.map((s) => (
            <button key={s.label} type="button" className="btn btn-secondary btn-sm" onClick={() => onChange(s.patch)}>
              {s.label}
            </button>
          ))}
          {changed && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onRestore}>
              <RotateCcw size={14} aria-hidden="true" />
              Valori del file
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function UndoImportButton({ importId }: { importId: string }) {
  return (
    <ActionButton action={removeLedgerImport} fields={{ importId }} variant="ghost" size="sm" confirm="Annullare l'importazione? Tutti i movimenti che ha creato verranno tolti dalla prima nota.">
      Annulla importazione
    </ActionButton>
  );
}
