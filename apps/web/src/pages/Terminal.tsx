import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Maximize2,
  Minus,
  Plug,
  Plus,
  RotateCw,
  Search,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { termRegistry } from "@/lib/term-registry";
import type { HostKeyPrompt, TerminalClient } from "@/lib/terminal-client";
import { TerminalView } from "@/components/TerminalView";
import { useTerminalStore } from "@/store/terminal";
import { Badge, Button, Dialog, Input, Select } from "@xterminal/ui";
import { terminalThemes } from "@/lib/terminal-themes";
import { cn } from "@/lib/utils";

export default function TerminalPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    tabs,
    activeKey,
    setActive,
    addTab,
    closeTab,
    updateTab,
    fontSize,
    setFontSize,
    theme,
    setTheme,
    splitView,
    setSplitView,
  } = useTerminalStore();

  const { data } = useQuery({ queryKey: ["connections"], queryFn: api.connections });
  const [hostKeyPrompt, setHostKeyPrompt] = useState<{
    prompt: HostKeyPrompt;
    client: TerminalClient | null;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const connectionIdParam = params.get("connection");

  // Open a tab when navigated here with ?connection=:id
  useEffect(() => {
    if (!connectionIdParam || !data) return;
    const existing = tabs.find((t) => t.connectionId === connectionIdParam);
    if (existing) {
      setActive(existing.key);
      return;
    }
    const c = data.connections.find((x) => x.id === connectionIdParam);
    if (c) {
      addTab({
        connectionId: c.id,
        label: c.nickname ?? c.host,
        host: `${c.username}@${c.host}:${c.port}`,
        sessionId: null,
        status: "connecting",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionIdParam, data]);

  const activeTab = tabs.find((t) => t.key === activeKey) ?? null;

  const doSearch = (dir: "next" | "prev") => {
    if (!activeKey) return;
    const entry = termRegistry.get(activeKey);
    if (!entry) return;
    if (dir === "next") entry.search.findNext(searchQuery);
    else entry.search.findPrevious(searchQuery);
  };

  const reconnectActive = () => {
    if (!activeTab) return;
    const { key, connectionId, label, host } = activeTab;
    const client = termRegistry.get(key)?.client;
    client?.close();
    closeTab(key);
    setTimeout(() => {
      addTab({ connectionId, label, host, sessionId: null, status: "connecting", key: `${key}-r${Date.now()}` });
    }, 50);
  };

  const duplicateActive = () => {
    if (!activeTab) return;
    addTab({
      connectionId: activeTab.connectionId,
      label: activeTab.label,
      host: activeTab.host,
      sessionId: null,
      status: "connecting",
    });
  };

  const disconnectActive = async () => {
    if (!activeTab?.sessionId) return;
    await api.terminateTerminal(activeTab.sessionId);
    void queryClient.invalidateQueries({ queryKey: ["terminal-sessions"] });
  };

  const clearActive = () => {
    if (!activeKey) return;
    termRegistry.get(activeKey)?.term.clear();
  };

  const renameActive = () => {
    if (!activeTab) return;
    const name = window.prompt("Rename tab", activeTab.label);
    if (name && name.trim()) updateTab(activeTab.key, { label: name.trim() });
  };

  const goFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const statusColor = (status: string) =>
    status === "connected"
      ? "bg-emerald-400"
      : status === "failed"
        ? "bg-red-400"
        : status === "closed"
          ? "bg-slate-500"
          : "bg-amber-400 animate-pulse";

  const visibleTabs = useMemo(() => tabs, [tabs]);
  const splitTabs = splitView ? visibleTabs.slice(-2) : [];
  const primaryTab = splitView ? splitTabs[0] : null;
  const secondaryTab = splitView ? splitTabs[1] : null;

  if (tabs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <TerminalSquare className="h-12 w-12 text-slate-700" />
        <div>
          <h2 className="text-base font-semibold text-slate-300">No active terminals</h2>
          <p className="mt-1 text-sm text-slate-500">
            Open a connection from the{" "}
            <button
              className="text-cyan-400 hover:text-cyan-300"
              onClick={() => navigate("/connections")}
            >
              connections page
            </button>{" "}
            or press <kbd className="rounded border border-edge px-1.5 py-0.5 text-xs">Ctrl K</kbd>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab bar */}
      <div className="glass flex items-center gap-1 overflow-x-auto border-b border-edge px-2 py-1.5">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={cn(
              "group flex h-8 min-w-32 max-w-52 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm transition-colors",
              activeKey === tab.key
                ? "bg-[#161d29] text-slate-100 ring-1 ring-edge"
                : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300",
            )}
          >
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusColor(tab.status))} />
            <span className="truncate">{tab.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                const client = termRegistry.get(tab.key)?.client;
                if (tab.sessionId && tab.status !== "closed") {
                  void api.terminateTerminal(tab.sessionId);
                }
                client?.close();
                closeTab(tab.key);
              }}
              className="rounded p-0.5 text-slate-600 opacity-0 hover:bg-[#0a0e15] hover:text-slate-300 group-hover:opacity-100"
              aria-label={`Close ${tab.label}`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <div className="ml-1 flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            title="New tab (go to connections)"
            onClick={() => navigate("/connections")}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="glass flex items-center gap-1 border-b border-edge px-2 py-1">
        <Button size="sm" variant="ghost" onClick={reconnectActive} title="Reconnect">
          <RotateCw className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void disconnectActive()} title="Disconnect">
          <Plug className="h-3.5 w-3.5 rotate-90" />
        </Button>
        <Button size="sm" variant="ghost" onClick={duplicateActive} title="Duplicate connection">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={renameActive} title="Rename tab">
          <span className="text-xs font-medium">Aa</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={clearActive} title="Clear terminal">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSearchOpen(!searchOpen);
            setTimeout(() => {
              if (searchQuery) doSearch("next");
            }, 50);
          }}
          title="Search"
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-1 h-4 w-px bg-edge" />
        <Button size="sm" variant="ghost" onClick={() => setFontSize(fontSize - 1)} title="Decrease font size">
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="w-6 text-center text-xs text-slate-500">{fontSize}</span>
        <Button size="sm" variant="ghost" onClick={() => setFontSize(fontSize + 1)} title="Increase font size">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="ml-1 h-7 w-36 py-0 text-xs"
          title="Terminal theme"
        >
          {terminalThemes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setSplitView(!splitView)}
          title="Split terminal"
          className={splitView ? "text-cyan-400" : ""}
        >
          <span className="text-xs">◫</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={goFullscreen} title="Fullscreen">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>

        {searchOpen && (
          <div className="ml-2 flex items-center gap-1">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doSearch(e.shiftKey ? "prev" : "next");
              }}
              placeholder="Search…"
              className="h-7 w-44 py-0 text-xs"
            />
            <Button size="sm" variant="ghost" onClick={() => doSearch("prev")} title="Previous match">
              ↑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => doSearch("next")} title="Next match">
              ↓
            </Button>
          </div>
        )}

        {/* Status bar right */}
        <div className="ml-auto flex items-center gap-2 pr-2 text-xs text-slate-500">
          {activeTab?.statusDetail && <span className="truncate">{activeTab.statusDetail}</span>}
          <Badge
            variant={
              activeTab?.status === "connected"
                ? "success"
                : activeTab?.status === "failed"
                  ? "danger"
                  : "warning"
            }
          >
            {activeTab?.status ?? "—"}
          </Badge>
          <span className="hidden font-mono md:inline">{activeTab?.host}</span>
        </div>
      </div>

      {/* Terminal area */}
      {splitView && primaryTab && secondaryTab ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-edge">
          <TerminalPane
            tab={primaryTab}
            active={activeKey === primaryTab.key}
            fontSize={fontSize}
            themeId={theme}
            onHostKeyPrompt={(prompt, client) => setHostKeyPrompt({ prompt, client })}
          />
          <TerminalPane
            tab={secondaryTab}
            active={activeKey === secondaryTab.key}
            fontSize={fontSize}
            themeId={theme}
            onHostKeyPrompt={(prompt, client) => setHostKeyPrompt({ prompt, client })}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {tabs.map((tab) => (
            <TerminalPane
              key={tab.key}
              tab={tab}
              active={activeKey === tab.key}
              fontSize={fontSize}
              themeId={theme}
              onHostKeyPrompt={(prompt, client) => setHostKeyPrompt({ prompt, client })}
            />
          ))}
        </div>
      )}

      {/* Host key verification dialog */}
      <HostKeyDialog
        state={hostKeyPrompt}
        onTrust={(mode) => {
          hostKeyPrompt?.client?.trust(mode);
          setHostKeyPrompt(null);
        }}
        onCancel={() => {
          hostKeyPrompt?.client?.cancelHostKey();
          setHostKeyPrompt(null);
        }}
      />
    </div>
  );
}

function TerminalPane({
  tab,
  active,
  fontSize,
  themeId,
  onHostKeyPrompt,
}: {
  tab: { key: string; connectionId: string };
  active: boolean;
  fontSize: number;
  themeId: string;
  onHostKeyPrompt: (prompt: HostKeyPrompt, client: TerminalClient) => void;
}) {
  return (
    <div
      className={cn("h-full min-h-0 w-full overflow-hidden bg-[#07090D]", active ? "block" : "hidden")}
    >
      <TerminalView
        tabKey={tab.key}
        connectionId={tab.connectionId}
        fontSize={fontSize}
        themeId={themeId}
        bell
        onHostKeyPrompt={onHostKeyPrompt}
      />
    </div>
  );
}

function HostKeyDialog({
  state,
  onTrust,
  onCancel,
}: {
  state: { prompt: HostKeyPrompt; client: TerminalClient | null } | null;
  onTrust: (mode: "once" | "save") => void;
  onCancel: () => void;
}) {
  if (!state) return null;
  const { prompt } = state;
  const changed = prompt.kind === "changed";

  return (
    <Dialog
      open
      onClose={onCancel}
      title={
        <span className={changed ? "text-red-400" : ""}>
          {changed ? "SSH HOST KEY CHANGED" : "Unknown SSH Host"}
        </span>
      }
      footer={
        changed ? (
          <>
            <Button variant="danger" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Review Key
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => onTrust("once")}>
              Trust Once
            </Button>
            <Button onClick={() => onTrust("save")}>Trust &amp; Save</Button>
          </>
        )
      }
    >
      {changed ? (
        <div className="space-y-3 text-sm">
          <p className="text-slate-300">
            The server's SSH host key at{" "}
            <span className="font-mono text-slate-100">
              {prompt.host}:{prompt.port}
            </span>{" "}
            does not match the previously trusted key.
          </p>
          <p className="text-slate-400">This could indicate:</p>
          <ul className="ml-4 list-disc space-y-1 text-slate-400">
            <li>Server reinstallation</li>
            <li>Host migration</li>
            <li>SSH configuration change</li>
            <li className="text-red-400">Possible MITM attack</li>
          </ul>
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 font-mono text-xs">
            <div className="text-slate-500">trusted:  {prompt.knownFingerprint}</div>
            <div className="text-red-300">current:  {prompt.fingerprint}</div>
          </div>
          <p className="text-xs text-slate-500">
            For safety, changed host keys are never accepted here. If you are sure this change is
            legitimate, remove the old entry under Known Hosts and reconnect.
          </p>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-300">
            <span className="font-mono text-slate-100">
              {prompt.host}:{prompt.port}
            </span>{" "}
            has not been verified yet.
          </p>
          <div className="rounded-lg border border-edge bg-[#0a0e15] p-3 font-mono text-xs">
            <div className="mb-1 text-slate-500">fingerprint</div>
            <div className="break-all text-cyan-300">{prompt.fingerprint}</div>
          </div>
          <p className="text-xs text-slate-500">
            Verify this fingerprint out-of-band (e.g. <span className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</span>{" "}
            on the server) before trusting it.
          </p>
        </div>
      )}
    </Dialog>
  );
}
