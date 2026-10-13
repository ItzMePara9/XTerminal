import { create } from "zustand";
import { api } from "@/lib/api";
import type { UserPublic } from "@xterminal/types";

interface AuthStore {
  user: UserPublic | null;
  loading: boolean;
  initialized: boolean;
  totpRequired: boolean;
  setTotpRequired: (v: boolean) => void;
  setUser: (user: UserPublic | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: false,
  initialized: false,
  totpRequired: false,

  setTotpRequired: (v) => set({ totpRequired: v }),
  setUser: (user) => set({ user, initialized: true }),

  refresh: async () => {
    set({ loading: true });
    try {
      const { user } = await api.me();
      set({ user, initialized: true, totpRequired: false });
    } catch {
      set({ user: null, initialized: true });
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null });
    }
  },
}));
