import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { SearchAddon } from "xterm-addon-search";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { TerminalClient, type HostKeyPrompt } from "@/lib/terminal-client";
import { themeById } from "@/lib/terminal-themes";
import { termRegistry } from "@/lib/term-registry";
import { useTerminalStore } from "@/store/terminal";

export interface TerminalViewProps {
  tabKey: string;
  connectionId: string;
  fontSize: number;
  themeId: string;
  bell: boolean;
  onHostKeyPrompt: (prompt: HostKeyPrompt, client: TerminalClient) => void;
}

/**
 * One live xterm.js instance bound to a real SSH session over WebSocket.
 */
export function TerminalView({
  tabKey,
  connectionId,
  fontSize,
  themeId,
  bell,
  onHostKeyPrompt,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const updateTab = useTerminalStore((s) => s.updateTab);
  const fitRef = useRef<FitAddon | null>(null);

  // ------------------------------------------------------------------
  // Open the session + terminal exactly once per tab.
  // ------------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    const theme = themeById(themeId);
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"JetBrains Mono", "Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize,
      theme: theme.theme,
      allowProposedApi: true,
      scrollback: 10_000,
      convertEol: false,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }
    termRef.current = term;
    fitRef.current = fit;

    const initial = { cols: term.cols, rows: term.rows };

    const client = new TerminalClient("pending", {
      onData: (data) => term.write(data),
      onStatus: (status, detail) =>
        updateTab(tabKey, { status: status as never, statusDetail: detail }),
      onHostKey: (prompt) => {
        if (prompt) onHostKeyPrompt(prompt, clientRef.current!);
      },
      onExit: (code) => {
        term.write(`\r\n\x1b[90m[process exited${code !== null ? ` with code ${code}` : ""}]\x1b[0m\r\n`);
        updateTab(tabKey, { status: "closed" });
      },
      onError: (message) => {
        term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
      },
      onReconnectAttempt: (attempt) => {
        updateTab(tabKey, { status: "reconnecting", statusDetail: `Attempt ${attempt}` });
        term.write(`\r\n\x1b[33m[connection lost - reconnecting, attempt ${attempt}]\x1b[0m\r\n`);
      },
    });
    clientRef.current = client;
    termRegistry.set(tabKey, { term, search, client });

    term.onData((data) => client.write(data));

    // Bell: xterm 5 fires onBell; play a subtle beep when enabled.
    if (bell) {
      term.onBell(() => {
        try {
          const Ctx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctx) return;
          const ctx = new Ctx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 830;
          gain.gain.value = 0.06;
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
          osc.onended = () => void ctx.close();
        } catch {
          /* audio unavailable */
        }
      });
    }

    // Fetch a one-time ticket and open the WebSocket.
    void (async () => {
      try {
        const res = await fetch(`/api/connections/${encodeURIComponent(connectionId)}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols: initial.cols, rows: initial.rows }),
          credentials: "same-origin",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          term.write(
            `\r\n\x1b[31mFailed to open session: ${body.message ?? res.statusText}\x1b[0m\r\n`,
          );
          updateTab(tabKey, { status: "failed", statusDetail: body.message ?? res.statusText });
          return;
        }
        const { sessionId, token } = (await res.json()) as {
          sessionId: string;
          token: string;
        };
        if (disposed) return;
        client.sessionId = sessionId;
        updateTab(tabKey, { sessionId });
        client.connect(token);
      } catch (err) {
        term.write(`\r\n\x1b[31mNetwork error: ${String(err)}\x1b[0m\r\n`);
        updateTab(tabKey, { status: "failed", statusDetail: String(err) });
      }
    })();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
        const c = clientRef.current;
        if (c) c.resize(term.cols, term.rows);
      } catch {
        /* ignore */
      }
    });
    resizeObserver.observe(container);

    const keepalive = setInterval(() => client.ping(), 30_000);

    return () => {
      disposed = true;
      clearInterval(keepalive);
      resizeObserver.disconnect();
      client.close();
      term.dispose();
      clientRef.current = null;
      termRef.current = null;
      termRegistry.delete(tabKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, connectionId]);

  // ------------------------------------------------------------------
  // Live settings: font size + theme + bell
  // ------------------------------------------------------------------
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontSize = fontSize;
    term.options.theme = themeById(themeId).theme;
    try {
      fitRef.current?.fit();
    } catch {
      /* ignore */
    }
  }, [fontSize, themeId, bell]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />;
}
