import type { Terminal } from "xterm";
import type { SearchAddon } from "xterm-addon-search";
import type { TerminalClient } from "@/lib/terminal-client";

/** Live xterm instances by tab key, so the toolbar can act on the active one. */
export const termRegistry = new Map<
  string,
  { term: Terminal; search: SearchAddon; client: TerminalClient }
>();
