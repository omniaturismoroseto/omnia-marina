import type { Metadata } from "next";
import { ActivationPage } from "./activation-form";

export const metadata: Metadata = { title: "Attiva l'accesso" };

export default function ActivatePage() {
  return <ActivationPage />;
}
