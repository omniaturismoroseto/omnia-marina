import { Suspense, type ReactNode } from "react";

export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Caricamento in corso">
      <div className="h-9 w-56 rounded bg-line-soft" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-line-soft" />
      <div className="mt-8 h-72 rounded-lg border border-line bg-card" />
    </div>
  );
}

/**
 * Ogni pagina legge sessione e dati al momento della richiesta. Avvolgendo il contenuto in
 * <Suspense> il passaggio da una pagina all'altra è immediato: compare subito il segnaposto
 * e i dati arrivano appena pronti.
 */
export function page<P extends object>(Content: (props: P) => Promise<ReactNode>) {
  return function Page(props: P) {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <Content {...props} />
      </Suspense>
    );
  };
}
