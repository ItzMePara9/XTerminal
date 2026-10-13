import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Input, Label } from "@xterminal/ui";
import { api, HttpError } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setUser, refresh, totpRequired, setTotpRequired } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.login({ email, password, totpCode: totpCode || undefined });
      setUser(user);
      navigate("/");
    } catch (err) {
      if (err instanceof HttpError && err.code === "TOTP_REQUIRED") {
        setTotpRequired(true);
        setError("Enter your 6-digit authenticator code");
      } else {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const loginWithSecurityKey = async () => {
    setBusy(true);
    setError(null);
    try {
      const { requestId, options } = await api.webauthnAuthOptions(email || undefined);
      const assertion = await startAuthentication(options as never);
      const { user } = await api.webauthnVerify(requestId, email || undefined, assertion);
      setUser(user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Security key authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="XTerminal" subtitle="Sign in to your workspace">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••"
          />
        </div>
        {totpRequired && (
          <div>
            <Label htmlFor="totp">Authenticator code</Label>
            <Input
              id="totp"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
              autoFocus
            />
          </div>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Sign in
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-slate-600">
        <div className="h-px flex-1 bg-edge" />
        or
        <div className="h-px flex-1 bg-edge" />
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => void loginWithSecurityKey()}
        disabled={busy}
      >
        <Fingerprint className="h-4 w-4" />
        Sign in with a security key
      </Button>

      <div className="mt-5 flex justify-between text-xs text-slate-500">
        <Link to="/forgot-password" className="hover:text-cyan-400">
          Forgot password?
        </Link>
        <Link to="/register" className="hover:text-cyan-400">
          Create account
        </Link>
      </div>
    </AuthLayout>
  );
}
