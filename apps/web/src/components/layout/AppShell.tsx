import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FolderTree,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Star,
  History,
  Terminal as TerminalIcon,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useTerminalStore } from "@/store/terminal";
import { CommandPalette } from "@/components/CommandPalette";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/connections", label: "Connections", icon: Plug },
  { to: "/groups", label: "Groups", icon: FolderTree },
  { to: "/favorites", label: "Favorites", icon: Star },
  { to: "/recent", label: "Recent", icon: History },
  { to: "/keys", label: "SSH Keys", icon: KeyRound },
  { to: "/known-hosts", label: "Known Hosts", icon: ShieldCheck },
  { to: "/security", label: "Security", icon: ShieldAlert },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppShell() {
  const { user, logout } = useAuthStore();
  const { sidebarOpen, setSidebarOpen, setPaletteOpen } = useTerminalStore();
  const navigate = useNavigate();
  const location = useLocation();

  // Ctrl+K command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside
        className={cn(
          "glass z-20 flex h-full shrink-0 flex-col border-r border-edge transition-all duration-200",
          sidebarOpen ? "w-60" : "w-0 overflow-hidden md:w-16",
        )}
      >
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/30">
            <TerminalIcon className="h-4 w-4 text-cyan-400" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <div className="text-sm font-semibold tracking-tight text-slate-100">
                XTerminal
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-cyan-500/10 text-cyan-300"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {sidebarOpen && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-edge p-2">
          <button
            onClick={() => void logout().then(() => navigate("/login"))}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {sidebarOpen && <span>Sign out</span>}
          </button>
          {sidebarOpen && user && (
            <div className="px-3 pb-2 pt-1 text-xs text-slate-600 truncate">
              {user.email}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass flex h-13 items-center gap-3 border-b border-edge px-4 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-8 flex-1 max-w-md items-center gap-2 rounded-lg border border-edge bg-[#0a0e15] px-3 text-sm text-slate-500 hover:border-cyan-500/30"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="rounded border border-edge bg-[#161d29] px-1.5 py-0.5 text-[10px] text-slate-500">
              Ctrl K
            </kbd>
          </button>
          <div className="ml-auto hidden text-sm text-slate-400 sm:block">
            {greeting}
            {user?.name ? `, ${user.name}` : ""}
          </div>
        </header>

        <main
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            location.pathname === "/terminal" && "overflow-hidden",
          )}
        >
          <Outlet />
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
