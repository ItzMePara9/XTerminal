import type { ClientFrame, ServerFrame } from "@xterminal/types";

export type HostKeyPrompt = {
  kind: "required" | "changed";
  host: string;
  port: number;
  fingerprint: string;
  knownFingerprint?: string;
};

export interface TerminalClientCallbacks {
  onData: (data: string) => void;
  onStatus: (status: string, detail?: string) => void;
  onHostKey: (prompt: HostKeyPrompt | null) => void;
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
  onReconnectAttempt: (attempt: number) => void;
}

/**
 * WebSocket client for a live SSH terminal session. Handles the JSON frame
 * protocol, host-key prompts, and reconnection to the same server-side
 * session (no duplicate SSH sessions).
 */
export class TerminalClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCols = 80;
  private lastRows = 24;

  constructor(
    public sessionId: string,
    private callbacks: TerminalClientCallbacks,
  ) {}

  connect(token: string): void {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws/terminal/${encodeURIComponent(this.sessionId)}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.callbacks.onHostKey(null);
      this.send({ t: "hello", cols: this.lastCols, rows: this.lastRows });
    };

    ws.onmessage = (event) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(event.data)) as ServerFrame;
      } catch {
        return;
      }
      this.dispatch(frame);
    };

    ws.onclose = (event) => {
      this.ws = null;
      if (this.closedByUser) return;
      if (event.code === 4404 || event.code === 4409 || event.code === 4403) {
        // Session is gone - do not retry.
        this.callbacks.onStatus("closed", "Session closed");
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private dispatch(frame: ServerFrame): void {
    switch (frame.t) {
      case "data":
        this.callbacks.onData(atob(frame.d));
        break;
      case "status":
        this.callbacks.onStatus(frame.status, frame.detail);
        break;
      case "hostkey-required":
        this.callbacks.onHostKey({
          kind: "required",
          host: frame.host,
          port: frame.port,
          fingerprint: frame.fingerprint,
        });
        break;
      case "hostkey-changed":
        this.callbacks.onHostKey({
          kind: "changed",
          host: frame.host,
          port: frame.port,
          fingerprint: frame.fingerprint,
          knownFingerprint: frame.knownFingerprint,
        });
        this.callbacks.onError(
          "SSH HOST KEY CHANGED - connection refused. Review the key before continuing.",
        );
        break;
      case "exit":
        this.callbacks.onExit(frame.code);
        break;
      case "error":
        this.callbacks.onError(frame.message);
        break;
      default:
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    this.callbacks.onReconnectAttempt(this.reconnectAttempts);
    if (this.reconnectAttempts > 10) {
      this.callbacks.onStatus("closed", "Connection lost");
      return;
    }
    const delay = Math.min(1000 * this.reconnectAttempts, 8000);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const res = await fetch(`/api/terminal/${encodeURIComponent(this.sessionId)}/reattach`, {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          this.callbacks.onStatus("closed", "Session expired");
          return;
        }
        const { token } = (await res.json()) as { token: string };
        if (!this.closedByUser) this.connect(token);
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  send(frame: ClientFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  /** User keystrokes -> SSH stdin. */
  write(data: string): void {
    if (data.length > 0) this.send({ t: "data", d: btoa(data) });
  }

  resize(cols: number, rows: number): void {
    this.lastCols = cols;
    this.lastRows = rows;
    this.send({ t: "resize", cols, rows });
  }

  trust(mode: "once" | "save"): void {
    this.callbacks.onHostKey(null);
    this.send({ t: "trust", mode });
  }

  cancelHostKey(): void {
    this.callbacks.onHostKey(null);
    this.send({ t: "cancel" });
    this.close();
  }

  ping(): void {
    this.send({ t: "ping" });
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client closed");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
