import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { Spinner } from "@xterminal/ui";
import { AppShell } from "@/components/layout/AppShell";
import LoginPage from "@/pages/auth/Login";
import RegisterPage from "@/pages/auth/Register";
import ForgotPasswordPage from "@/pages/auth/ForgotPassword";
import ResetPasswordPage from "@/pages/auth/ResetPassword";
import VerifyEmailPage from "@/pages/auth/VerifyEmail";
import DashboardPage from "@/pages/Dashboard";
import ConnectionsPage from "@/pages/Connections";
import GroupsPage from "@/pages/Groups";
import SshKeysPage from "@/pages/SshKeys";
import KnownHostsPage from "@/pages/KnownHosts";
import SecurityPage from "@/pages/Security";
import SettingsPage from "@/pages/Settings";
import TerminalPage from "@/pages/Terminal";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuthStore();
  if (!initialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="favorites" element={<ConnectionsPage favoritesOnly />} />
        <Route path="recent" element={<ConnectionsPage recentOnly />} />
        <Route path="keys" element={<SshKeysPage />} />
        <Route path="known-hosts" element={<KnownHostsPage />} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="terminal" element={<TerminalPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
