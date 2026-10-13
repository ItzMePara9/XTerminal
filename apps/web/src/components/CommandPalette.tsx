import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderPlus,
  KeyRound,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { api } from "@/lib/api";
import { useTerminalStore } from "@/store/terminal";
import { Dialog } from "@xterminal/ui";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useTerminalStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useQuery({
    queryKey: ["connections"],
    queryFn: api.connections,
    enabled: paletteOpen,
  });

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [paletteOpen]);

  const close = () => setPaletteOpen(false);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "new-connection",
        label: "New Connection",
        icon: <Plus className="h-4 w-4 text-cyan-400" />,
        run: () => navigate("/connections?new=1"),
      },
      {
        id: "open-connections",
        label: "Open Connections",
        icon: <Plug className="h-4 w-4" />,
        run: () => navigate("/connections"),
      },
      {
        id: "new-group",
        label: "New Group",
        icon: <FolderPlus className="h-4 w-4" />,
        run: () => navigate("/groups?new=1"),
      },
      {
        id: "open-keys",
        label: "Open SSH Keys",
        icon: <KeyRound className="h-4 w-4" />,
        run: () => navigate("/keys"),
      },
      {
        id: "open-known-hosts",
        label: "Open Known Hosts",
        icon: <ShieldCheck className="h-4 w-4" />,
        run: () => navigate("/known-hosts"),
      },
      {
        id: "open-settings",
        label: "Open Settings",
        icon: <Settings className="h-4 w-4" />,
        run: () => navigate("/settings"),
      },
      {
        id: "disconnect-all",
        label: "Disconnect All Terminals",
        icon: <Unplug className="h-4 w-4 text-red-400" />,
        run: async () => {
          const { sessions } = await api.listTerminals();
          await Promise.all(sessions.map((s) => api.terminateTerminal(s.sessionId)));
          await queryClient.invalidateQueries({ queryKey: ["terminal-sessions"] });
        },
      },
    ];

    for (const c of data?.connections ?? []) {
      cmds.push({
        id: `connect-${c.id}`,
        label: `Connect ${c.nickname ?? c.host}`,
        hint: `${c.username}@${c.host}:${c.port}`,
        icon: <Plug className="h-4 w-4 text-emerald-400" />,
        run: () =>
          navigate(
            `/terminal?connection=${c.id}`,
          ),
      });
    }
    return cmds;
  }, [data?.connections, navigate, queryClient]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 12);
    return commands
      .filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          (c.hint ?? "").toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [commands, query]);

  const runSelected = (index: number) => {
    const cmd = filtered[index];
    if (!cmd) return;
    close();
    void cmd.run();
  };

  return (
    <Dialog open={paletteOpen} onClose={close} wide>
      <div className="flex items-center gap-3 border-b border-edge pb-3">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runSelected(selected);
            }
          }}
          placeholder="Type a command or search connections…"
          className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
        />
      </div>
      <div className="mt-2 space-y-0.5">
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-slate-500">No results</div>
        )}
        {filtered.map((cmd, i) => (
          <button
            key={cmd.id}
            onMouseEnter={() => setSelected(i)}
            onClick={() => runSelected(i)}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
              i === selected ? "bg-cyan-500/10 text-cyan-200" : "text-slate-300 hover:bg-white/[0.04]"
            }`}
          >
            {cmd.icon}
            <span className="flex-1 truncate">{cmd.label}</span>
            {cmd.hint && <span className="truncate text-xs text-slate-600">{cmd.hint}</span>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
