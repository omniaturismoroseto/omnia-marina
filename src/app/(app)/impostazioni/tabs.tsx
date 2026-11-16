import Link from "next/link";

const TABS = [
  { key: "porto", href: "/impostazioni", label: "Porto" },
  { key: "pontili", href: "/impostazioni/pontili", label: "Pontili e posti" },
  { key: "pianta", href: "/impostazioni/pianta", label: "Pianta dal vero" },
  { key: "categorie", href: "/impostazioni/categorie", label: "Categorie" },
  { key: "utenti", href: "/impostazioni/utenti", label: "Utenti" },
  { key: "registro", href: "/impostazioni/registro", label: "Registro" },
] as const;

export function SettingsTabs({ current }: { current: (typeof TABS)[number]["key"] }) {
  return (
    // Su schermi stretti le schede scorrono di lato, senza barra di scorrimento. La linea di base è un'ombra interna:
    // se la scheda attiva sporgesse sotto il bordo, Windows mostrerebbe una barra verticale con le frecce.
    <nav
      className="no-print mb-5 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Sezioni delle impostazioni"
    >
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`border-b-2 px-3 py-2 text-[15px] font-medium whitespace-nowrap ${
            t.key === current ? "border-buoy text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
