import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ChevronLeft, LifeBuoy } from "lucide-react";

type Tone = "neutral" | "sea" | "ok" | "warn" | "bad" | "buoy";

const TONE: Record<Tone, string> = {
  neutral: "bg-line-soft text-muted",
  sea: "bg-sea-soft text-sea-dark",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  buoy: "bg-buoy-soft text-buoy-dark",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${TONE[tone]}`}>{children}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  help,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  // Sezione della Guida che spiega la pagina (/guida#help).
  help?: string;
}) {
  return (
    <header className="mb-6">
      {back && (
        <Link href={back.href} className="no-print mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ChevronLeft size={16} aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="font-display text-[28px] leading-tight font-semibold text-ink sm:text-[32px]">{title}</h1>
            {help && (
              <Link
                href={`/guida#${help}`}
                className="no-print inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted hover:border-sea hover:text-sea-dark"
                title="Come si usa questa pagina"
              >
                <LifeBuoy size={13} aria-hidden="true" />
                Guida
              </Link>
            )}
          </div>
          {description && <p className="mt-1 max-w-2xl text-[15px] text-muted">{description}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  // flush: il contenuto (tipicamente una tabella) arriva fino ai bordi.
  flush?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "overflow-x-auto" : "p-4"}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "accent";

export function ButtonLink({
  variant = "secondary",
  size,
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: "sm" | "lg" }) {
  return <Link {...props} className={`btn btn-${variant} ${size ? `btn-${size}` : ""} ${className}`} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  href?: string;
  tone?: "bad" | "warn" | "ok";
}) {
  const valueColor = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink";
  const body = (
    <>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={`mt-1 text-[28px] leading-tight font-semibold tabular-nums ${valueColor}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:border-faint">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

// Elenco etichetta/valore per le schede di dettaglio. Le voci senza valore non vengono mostrate.
export function Details({ items, columns = 2 }: { items: [label: string, value: ReactNode][]; columns?: 1 | 2 | 3 }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== "—");
  if (shown.length === 0) return <p className="text-sm text-muted">Nessun dato inserito.</p>;
  const grid = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${grid}`}>
      {shown.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-muted">{label}</dt>
          <dd className="mt-0.5 text-[15px] break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok" | "sea"; children: ReactNode }) {
  const border = { warn: "border-warn/30", bad: "border-bad/30", ok: "border-ok/30", sea: "border-sea/30" }[tone];
  return <div className={`rounded-md border px-3 py-2 text-sm ${border} ${TONE[tone]}`}>{children}</div>;
}

export function SearchBox({ action, defaultValue, placeholder, children }: { action: string; defaultValue?: string; placeholder: string; children?: ReactNode }) {
  return (
    <form action={action} className="no-print flex flex-wrap items-center gap-2" role="search">
      <input type="search" name="q" defaultValue={defaultValue} placeholder={placeholder} aria-label={placeholder} className="input w-64 max-w-full" />
      {children}
      <button type="submit" className="btn btn-secondary">
        Cerca
      </button>
    </form>
  );
}

// Filtri a schede basati sull'indirizzo (?chiave=valore).
export function FilterTabs({ items, current }: { items: { href: string; label: string; value: string; count?: number }[]; current: string }) {
  return (
    <nav className="no-print flex flex-wrap gap-1" aria-label="Filtri">
      {items.map((item) => {
        const active = item.value === current;
        return (
          <Link
            key={item.value}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-ink text-white" : "text-muted hover:bg-line-soft hover:text-ink"
            }`}
          >
            {item.label}
            {item.count !== undefined && <span className={`ml-1.5 tabular-nums ${active ? "text-white/70" : "text-faint"}`}>{item.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
