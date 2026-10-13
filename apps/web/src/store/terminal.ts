import { create } from "zustand";

export interface TerminalTab {
  key: string;
  connectionId: string;
  label: string;
  host: string;
  sessionId: string | null;
  status: "connecting" | "connected" | "reconnecting" | "failed" | "closed";
  statusDetail?: string;
}

interface TerminalStore {
  tabs: TerminalTab[];
  activeKey: string | null;
  sidebarOpen: boolean;
  paletteOpen: boolean;
  fontSize: number;
  theme: string;
  splitView: boolean;

  addTab: (tab: Omit<TerminalTab, "key"> & { key?: string }) => string;
  closeTab: (key: string) => void;
  setActive: (key: string) => void;
  updateTab: (key: string, patch: Partial<TerminalTab>) => void;
  setSidebarOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setFontSize: (size: number) => void;
  setTheme: (theme: string) => void;
  setSplitView: (v: boolean) => void;
}

const FONT_KEY = "xt.font-size";
const THEME_KEY = "xt.theme";
const SPLIT_KEY = "xt.split";

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  tabs: [],
  activeKey: null,
  sidebarOpen: true,
  paletteOpen: false,
  fontSize: Number(readLS(FONT_KEY, "14")) || 14,
  theme: readLS(THEME_KEY, "xt-dark"),
  splitView: readLS(SPLIT_KEY, "0") === "1",

  addTab: (tab) => {
    const key = tab.key ?? crypto.randomUUID();
    set((s) => ({
      tabs: [...s.tabs, { ...tab, key }],
      activeKey: key,
    }));
    return key;
  },

  closeTab: (key) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.key === key);
      const tabs = s.tabs.filter((t) => t.key !== key);
      let activeKey = s.activeKey;
      if (s.activeKey === key) {
        activeKey = tabs[Math.max(0, idx - 1)]?.key ?? null;
      }
      return { tabs, activeKey };
    }),

  setActive: (key) => set({ activeKey: key }),

  updateTab: (key, patch) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  setFontSize: (size) => {
    try {
      localStorage.setItem(FONT_KEY, String(size));
    } catch {
      /* private mode */
    }
    set({ fontSize: size });
  },

  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
    set({ theme });
  },

  setSplitView: (v) => {
    try {
      localStorage.setItem(SPLIT_KEY, v ? "1" : "0");
    } catch {
      /* private mode */
    }
    set({ splitView: v });
  },
}));
