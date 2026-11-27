"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Maximize } from "@/components/icons";

// Ingrandimento massimo rispetto alla foto intera adattata allo schermo.
const MAX_ZOOM = 8;
// Ingrandimento massimo assoluto (pixel dello schermo per pixel della pianta): sul telefono la vista intera è piccola
// e «8 volte» non basterebbe a vedere bene i posti, quindi vale il più grande dei due limiti.
const MAX_SCALE = 6;
// Spostamento (in pixel dello schermo) oltre il quale un tocco diventa un trascinamento e non apre il posto.
const DRAG_THRESHOLD = 6;

type View = { x: number; y: number; s: number };
type Size = { w: number; h: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Pianta a tutto schermo: la foto si adatta allo spazio disponibile, si sposta trascinando con il mouse
 * o con un dito, si ingrandisce con la rotellina, con due dita o con un doppio clic. Niente barre né pulsanti di zoom.
 * `width` e `height` sono le misure della foto: il contenuto (un SVG largo il 100%) viene disegnato a quella misura.
 */
export function PlanZoom({
  width,
  height,
  children,
  fillScreen = false,
  arrowKeys = true,
  focus = null,
}: {
  width: number;
  height: number;
  children: ReactNode;
  // Mappa: alta fino al fondo dello schermo, qualunque siano le proporzioni della pianta.
  fillScreen?: boolean;
  // false: le frecce della tastiera non spostano la vista (nell'editor spostano i posti scelti).
  arrowKeys?: boolean;
  // Zona della pianta (in pixel della foto) da inquadrare all'apertura al posto della foto intera, es. un pontile.
  focus?: { x: number; y: number; width: number; height: number } | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [fillHeight, setFillHeight] = useState<number | null>(null);

  // Altezza = dal punto in cui comincia la mappa al fondo della finestra (meno la barra in basso sul telefono).
  useLayoutEffect(() => {
    if (!fillScreen) return;
    const measure = () => {
      const el = outerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const gap = window.innerWidth >= 1024 ? 20 : 84;
      let h = window.innerHeight - top - gap;
      // Se sopra la mappa c'è molto (telefono): alta quasi quanto lo schermo, la si porta in vista scorrendo.
      if (h < window.innerHeight * 0.6) h = window.innerHeight - gap - 70;
      setFillHeight(Math.max(320, Math.round(h)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fillScreen]);
  const [box, setBox] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  // Finché l'utente non ingrandisce o sposta, la foto resta adattata allo schermo anche se cambia la finestra.
  const fitted = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    start: { x: number; y: number };
    moved: boolean;
    pinch: { dist: number; mid: { x: number; y: number } } | null;
  }>({
    start: { x: 0, y: 0 },
    moved: false,
    pinch: null,
  });
  const suppressClick = useRef(false);

  const fitScale = box ? Math.min(box.w / width, box.h / height) : 1;

  // Tiene la foto dentro il riquadro: se è più piccola la centra, altrimenti non lascia vuoti ai bordi.
  const bound = useCallback(
    (v: View, size: Size): View => {
      const min = Math.min(size.w / width, size.h / height);
      const s = clamp(v.s, min, Math.max(min * MAX_ZOOM, MAX_SCALE));
      const cw = width * s;
      const ch = height * s;
      const x = cw <= size.w ? (size.w - cw) / 2 : clamp(v.x, size.w - cw, 0);
      const y = ch <= size.h ? (size.h - ch) / 2 : clamp(v.y, size.h - ch, 0);
      return { x, y, s };
    },
    [width, height],
  );

  const focusKey = focus ? `${focus.x},${focus.y},${focus.width},${focus.height}` : "";
  const fit = useCallback(
    (size: Size) => {
      if (!focus || focus.width <= 0 || focus.height <= 0) return bound({ x: 0, y: 0, s: 0 }, size);
      const s = Math.min(size.w / focus.width, size.h / focus.height);
      return bound({ s, x: size.w / 2 - (focus.x + focus.width / 2) * s, y: size.h / 2 - (focus.y + focus.height / 2) * s }, size);
    },
    // focusKey al posto di focus: un oggetto nuovo con la stessa zona non deve rifare l'inquadratura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bound, focusKey],
  );

  // Zona inquadrata l'ultima volta: cambiandola si torna a inquadrarla (vedi la misura qui sotto).
  const lastFocus = useRef(focusKey);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const size = { w: el.clientWidth, h: el.clientHeight };
      if (size.w === 0 || size.h === 0) return;
      setBox(size);
      if (lastFocus.current !== focusKey) {
        lastFocus.current = focusKey;
        fitted.current = true;
      }
      setView((v) =>
        v === null || fitted.current ? fit(size) : bound(v, size),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bound, fit, focusKey]);

  // Ingrandisce (factor > 1) o riduce mantenendo fermo il punto (px, py) del riquadro.
  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      if (!box) return;
      setView((v) => {
        if (!v) return v;
        const next = bound({ ...v, s: v.s * factor }, box);
        const k = next.s / v.s;
        fitted.current = false;
        return bound(
          { s: next.s, x: px - (px - v.x) * k, y: py - (py - v.y) * k },
          box,
        );
      });
    },
    [box, bound],
  );

  // La rotellina va agganciata a mano: React la registra come passiva e non si potrebbe fermare lo scorrimento della pagina.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Con il trackpad «pizzicato» arriva ctrlKey e passi piccoli: serve più sensibilità.
      const speed = e.ctrlKey ? 0.01 : e.deltaMode === 1 ? 0.05 : 0.0015;
      zoomAt(
        Math.exp(-e.deltaY * speed),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function local(e: { clientX: number; clientY: number }) {
    const rect = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function pinchOf() {
    const [a, b] = [...pointers.current.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      gesture.current = { start: p, moved: false, pinch: null };
    } else if (pointers.current.size === 2) {
      // Con due dita è sempre un gesto sulla pianta, mai un tocco su un posto.
      gesture.current.moved = true;
      gesture.current.pinch = pinchOf();
      for (const id of pointers.current.keys())
        e.currentTarget.setPointerCapture(id);
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !box) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;

    if (pointers.current.size >= 2 && g.pinch) {
      const now = pinchOf();
      const before = g.pinch;
      g.pinch = now;
      setView((v) => {
        if (!v) return v;
        const next = bound(
          { ...v, s: v.s * (now.dist / Math.max(1, before.dist)) },
          box,
        );
        const k = next.s / v.s;
        // Ingrandisce attorno al punto tra le dita e lo segue mentre si spostano.
        return bound(
          {
            s: next.s,
            x: now.mid.x - (before.mid.x - v.x) * k,
            y: now.mid.y - (before.mid.y - v.y) * k,
          },
          box,
        );
      });
      fitted.current = false;
      return;
    }

    if (!g.moved) {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < DRAG_THRESHOLD) return;
      g.moved = true;
      // La cattura parte solo ora: un tocco fermo resta un clic sul posto.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    setView((v) => (v ? bound({ ...v, x: v.x + dx, y: v.y + dy }, box) : v));
    fitted.current = false;
  }

  function onPointerEnd(e: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g.moved) suppressClick.current = true;
    if (pointers.current.size === 1) {
      // Rimasto un dito dopo il pizzico: continua come trascinamento da dove si trova.
      g.pinch = null;
      g.start = [...pointers.current.values()][0];
    } else if (pointers.current.size === 0) {
      g.pinch = null;
    }
  }

  function onClickCapture(e: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!box) return;
    const step = 60;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[e.key] && arrowKeys) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setView((v) => (v ? bound({ ...v, x: v.x + dx, y: v.y + dy }, box) : v));
      fitted.current = false;
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAt(1.4, box.w / 2, box.h / 2);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomAt(1 / 1.4, box.w / 2, box.h / 2);
    } else if (e.key === "0") {
      e.preventDefault();
      reset();
    }
  }

  function reset() {
    if (!box) return;
    fitted.current = true;
    setView(fit(box));
  }

  const zoom = view ? view.s / fitScale : 1;
  const atFit = zoom <= 1.001;

  return (
    // Negli editor: alto quanto la pianta alla larghezza disponibile, ma mai più dello schermo.
    // Nella mappa (fillScreen): tutta la larghezza e tutta l'altezza fino al fondo dello schermo.
    <div
      ref={outerRef}
      className={fillScreen ? "relative overflow-hidden rounded-lg bg-[#edf2f5]" : "relative max-h-[calc(100dvh-9rem)] min-h-64 lg:max-h-[calc(100dvh-5rem)]"}
      style={fillScreen ? { height: fillHeight ?? "70dvh" } : { aspectRatio: `${width} / ${height}` }}
    >
      <div
        ref={boxRef}
        tabIndex={0}
        aria-label="Pianta: trascina per spostarla, rotellina o due dita per ingrandire"
        className={`absolute inset-0 touch-none overflow-hidden select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sea ${
          atFit ? "" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const p = local(e);
          zoomAt(2, p.x, p.y);
        }}
        onKeyDown={onKeyDown}
      >
        <div
          style={{
            width,
            height,
            transformOrigin: "0 0",
            // Le icone dei servizi si rimpiccioliscono di quanto si ingrandisce: sullo schermo restano della stessa misura.
            ["--plan-zoom" as string]: zoom,
            // Pixel dello schermo per pixel della pianta: i segnaposto dei servizi lo usano per avere sempre la stessa misura vera sullo
            // schermo (anche sul telefono, dove la pianta intera è piccola).
            ["--plan-px" as string]: view?.s ?? 1,
            transform: view
              ? `translate(${view.x}px, ${view.y}px) scale(${view.s})`
              : undefined,
            visibility: view ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
      </div>

      {!atFit && (
        <div className="no-print absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border border-line bg-card/95 shadow-md backdrop-blur">
          <button
            type="button"
            className="grid size-10 place-items-center text-ink hover:bg-line-soft"
            aria-label="Adatta allo schermo"
            title="Torna alla foto intera"
            onClick={reset}
          >
            <Maximize size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
