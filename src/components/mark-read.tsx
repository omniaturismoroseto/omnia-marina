"use client";

import { useEffect } from "react";
import { markMessageRead } from "@/server/message-actions";

/** Segna il messaggio come letto quando la pagina si apre davvero (non quando viene solo precaricata). */
export function MarkRead({ messageId }: { messageId: string }) {
  useEffect(() => {
    markMessageRead(messageId).catch(() => {});
  }, [messageId]);
  return null;
}
