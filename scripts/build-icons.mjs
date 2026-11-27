// Genera src/components/icons.tsx dalle Material Symbols arrotondate piene (@material-symbols/svg-400).
// Le icone tengono i nomi usati nell'app (gli stessi che avevano con Lucide). Uso: node scripts/build-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ICONS = {
  Accessibility: "accessible",
  Anchor: "anchor",
  ArrowDownToLine: "vertical_align_bottom",
  ArrowLeftRight: "swap_horiz",
  ArrowRight: "arrow_forward",
  ArrowUp: "arrow_upward",
  ArrowUpFromLine: "vertical_align_top",
  Banknote: "payments",
  Bell: "notifications",
  BellOff: "notifications_off",
  Building2: "apartment",
  Bus: "directions_bus",
  CarTaxiFront: "local_taxi",
  Check: "check",
  ChevronLeft: "chevron_left",
  ChevronRight: "chevron_right",
  Clock: "schedule",
  CloudSun: "partly_cloudy_day",
  Coffee: "local_cafe",
  Copy: "content_copy",
  Cross: "emergency",
  Download: "download",
  Droplets: "water_drop",
  Ellipsis: "more_horiz",
  Eraser: "ink_eraser",
  Eye: "visibility",
  EyeOff: "visibility_off",
  FileSpreadsheet: "table",
  FileText: "description",
  Flag: "flag",
  GripVertical: "drag_indicator",
  Forklift: "forklift",
  Fuel: "local_gas_station",
  Hammer: "hardware",
  Hotel: "hotel",
  Image: "image",
  ImageUp: "add_photo_alternate",
  Info: "info",
  LayoutDashboard: "dashboard",
  LifeBuoy: "support",
  LoaderCircle: "progress_activity",
  LogOut: "logout",
  Mail: "mail",
  MailCheck: "mark_email_read",
  Map: "map",
  MapPin: "location_on",
  Maximize: "fullscreen",
  MessageCircle: "chat_bubble",
  Minus: "remove",
  MousePointer2: "arrow_selector_tool",
  Pencil: "edit",
  Phone: "call",
  Pill: "pill",
  Plug: "power",
  Plus: "add",
  Printer: "print",
  Radio: "sensors",
  RotateCcw: "rotate_left",
  Ruler: "straighten",
  Sailboat: "sailing",
  ScanSearch: "image_search",
  Search: "search",
  Settings: "settings",
  ShieldAlert: "gpp_maybe",
  ShoppingCart: "shopping_cart",
  ShowerHead: "shower",
  Sparkles: "star_shine",
  Spline: "polyline",
  SquareParking: "local_parking",
  Store: "storefront",
  Tags: "sell",
  Toilet: "wc",
  Trash2: "delete",
  Trees: "park",
  TriangleAlert: "warning",
  Undo2: "undo",
  Redo2: "redo",
  Upload: "upload",
  UserRound: "person",
  Users: "group",
  UtensilsCrossed: "restaurant",
  Wallet: "account_balance_wallet",
  Wand2: "wand_stars",
  Warehouse: "warehouse",
  WashingMachine: "local_laundry_service",
  Waves: "waves",
  Wifi: "wifi",
  Wind: "air",
  Wrench: "build",
  X: "close",
  Zap: "bolt",
};

const require = createRequire(import.meta.url);
const dir = path.join(path.dirname(require.resolve("@material-symbols/svg-400/package.json")), "rounded");
const lines = Object.entries(ICONS).map(([name, symbol]) => {
  const svg = readFileSync(path.join(dir, `${symbol}-fill.svg`), "utf8");
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length !== 1) throw new Error(`${symbol}: ${paths.length} tracciati`);
  return `export const ${name} = icon("${name}", "${paths[0]}");`;
});

const out = `// File generato da scripts/build-icons.mjs: non modificare a mano.
// Icone Material Symbols arrotondate piene (Google, licenza Apache 2.0).
import type { SVGProps } from "react";

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}
export type AppIcon = ((props: IconProps) => React.JSX.Element) & { displayName?: string };

function icon(name: string, d: string): AppIcon {
  // strokeWidth non serve alle icone piene: si toglie per non disegnare un bordo.
  const Icon: AppIcon = ({ size = 24, color = "currentColor", strokeWidth: _stroke, ...rest }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width={size} height={size} fill={color} {...rest}>
      <path d={d} />
    </svg>
  );
  Icon.displayName = name;
  return Icon;
}

${lines.join("\n")}
`;
writeFileSync(new URL("../src/components/icons.tsx", import.meta.url), out);
console.log(`${lines.length} icone scritte in src/components/icons.tsx`);
