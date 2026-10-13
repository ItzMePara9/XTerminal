import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Pencil, ShieldCheck, Trash2 } from "lucide-react";
import { api, HttpError } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  Input,
  Label,
  Spinner,
} from "@xterminal/ui";
import { formatDate } from "@/lib/utils";

export default function SecurityPage() {
  const { user, refresh } = useAuthStore();
  const queryClient = useQueryClient();

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Security</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Account authentication factors and active sessions
        </p>
      </div>

      <TotpCard onChanged={refresh} enabled={user?.totpEnabled ?? false} />
      <SecurityKeysCard />
      <SessionsCard />

      <Card>
        <CardHeader>
          <CardTitle>Account status</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Email</span>
            <span className="flex items-center gap-2 text-slate-200">
              {user?.email}
              <Badge variant={user?.emailVerified ? "success" : "warning"}>
                {user?.emailVerified ? "verified" : "unverified"}
              </Badge>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Password</span>
            <span className="text-slate-200">Argon2id hashed</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Credentials at rest</span>
            <span className="text-slate-200">AES-256-GCM envelope encryption</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TOTP 2FA
// ---------------------------------------------------------------------------

function TotpCard({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qrRef = useRef<CanvasElement>(null);

  const startSetup = useMutation({
    mutationFn: api.totpSetup,
    onSuccess: (res) => setSetup(res),
    onError: (err) => setError(err instanceof HttpError ? err.message : "Failed to start setup"),
  });

  useEffect(() => {
    if (setup && qrRef.current) {
      void QRCode.toCanvas(qrRef.current, setup.uri, {
        width: 180,
        color: { dark: "#07090d", light: "#e6edf3" },
        margin: 1,
      });
    }
  }, [setup]);

  const enable = useMutation({
    mutationFn: () => api.totpEnable(code),
    onSuccess: () => {
      setSetup(null);
      setCode("");
      setError(null);
      onChanged();
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (err) => setError(err instanceof HttpError ? err.message : "Invalid code"),
  });

  const disable = useMutation({
    mutationFn: () => api.totpDisable(disableCode),
    onSuccess: () => {
      setDisableCode("");
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof HttpError ? err.message : "Invalid code"),
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Two-factor authentication (TOTP)</CardTitle>
        <Badge variant={enabled ? "success" : "default"}>{enabled ? "enabled" : "disabled"}</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        {!enabled ? (
          <>
            <p className="text-sm text-slate-400">
              Require a rotating 6-digit code from an authenticator app (Aegis, 1Password,
              Google Authenticator…) in addition to your password.
            </p>
            {!setup ? (
              <Button onClick={() => startSetup.mutate()} disabled={startSetup.isPending}>
                {startSetup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Set up TOTP
              </Button>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row">
                <canvas ref={qrRef} className="rounded-lg border border-edge" />
                <div className="flex-1 space-y-3">
                  <div>
                    <Label>Secret (manual entry)</Label>
                    <code className="block break-all rounded-lg border border-edge bg-[#0a0e15] px-3 py-2 font-mono text-xs text-slate-300">
                      {setup.secret}
                    </code>
                  </div>
                  <div>
                    <Label htmlFor="totp-verify">Enter the current code to activate</Label>
                    <div className="flex gap-2">
                      <Input
                        id="totp-verify"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        className="w-32 font-mono tracking-[0.3em]"
                        placeholder="123456"
                      />
                      <Button onClick={() => enable.mutate()} disabled={code.length !== 6 || enable.isPending}>
                        {enable.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Activate
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400">
              Enter a code from your authenticator to disable two-factor authentication.
            </p>
            <div className="flex gap-2">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                className="w-32 font-mono tracking-[0.3em]"
                placeholder="123456"
              />
              <Button
                variant="danger"
                onClick={() => disable.mutate()}
                disabled={disableCode.length !== 6 || disable.isPending}
              >
                Disable TOTP
              </Button>
            </div>
          </>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

type CanvasElement = HTMLCanvasElement;

// ---------------------------------------------------------------------------
// WebAuthn security keys
// ---------------------------------------------------------------------------

function SecurityKeysCard() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["security-keys"], queryFn: api.securityKeys });

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await api.webauthnRegisterOptions();
      const attestation = await startRegistration(options as never);
      await api.webauthnRegister(name.trim() || "Security key", attestation);
      setAdding(false);
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["security-keys"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSecurityKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["security-keys"] }),
  });

  const rename = useMutation({
    mutationFn: () => api.renameSecurityKey(renaming!.id, renaming!.name),
    onSuccess: () => {
      setRenaming(null);
      void queryClient.invalidateQueries({ queryKey: ["security-keys"] });
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Security keys (FIDO2 / WebAuthn)</CardTitle>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Fingerprint className="h-4 w-4" />
          Add Security Key
        </Button>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (data?.keys ?? []).length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            No security keys registered. Add a FIDO2 key (YubiKey, Titan, Touch ID, Windows
            Hello…) to sign in without a password.
          </p>
        ) : (
          <div className="space-y-2">
            {data!.keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-3 rounded-lg border border-edge bg-[#0a0e15] px-3 py-2.5"
              >
                <Fingerprint className="h-4 w-4 text-cyan-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-200">{k.name}</div>
                  <div className="text-xs text-slate-600">
                    added {formatDate(k.createdAt)}
                    {k.lastUsedAt ? ` · last used ${formatDate(k.lastUsedAt)}` : ""}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Rename"
                  onClick={() => setRenaming({ id: k.id, name: k.name })}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Remove"
                  onClick={() => remove.mutate(k.id)}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <Dialog
          open={adding}
          onClose={() => setAdding(false)}
          title="Register a security key"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button onClick={() => void register()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                Register key
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="key-name">Key name</Label>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="YubiKey 5C"
                autoFocus
              />
            </div>
            <p className="text-xs text-slate-500">
              After clicking "Register key", your browser will ask you to touch or otherwise
              activate the security key.
            </p>
            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}
          </div>
        </Dialog>

        <Dialog
          open={!!renaming}
          onClose={() => setRenaming(null)}
          title="Rename security key"
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button onClick={() => rename.mutate()} disabled={!renaming?.name.trim()}>
                Save
              </Button>
            </>
          }
        >
          <Label htmlFor="rename-key">Name</Label>
          <Input
            id="rename-key"
            value={renaming?.name ?? ""}
            onChange={(e) =>
              setRenaming((r) => (r ? { ...r, name: e.target.value } : r))
            }
          />
        </Dialog>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function SessionsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["auth-sessions"], queryFn: api.sessions });

  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth-sessions"] }),
  });

  const logoutAll = useMutation({
    mutationFn: api.logoutAll,
    onSuccess: () => {
      window.location.href = "/login";
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>Active sessions</CardTitle>
        <Button size="sm" variant="danger" onClick={() => logoutAll.mutate()}>
          Revoke all
        </Button>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-2">
            {(data?.sessions ?? []).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-lg border border-edge bg-[#0a0e15] px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-300">
                    {s.userAgent ?? "Unknown client"}
                  </div>
                  <div className="text-xs text-slate-600">
                    {s.ip ?? "unknown ip"} · started {formatDate(s.createdAt)} · expires{" "}
                    {formatDate(s.expiresAt)}
                  </div>
                </div>
                {s.current ? (
                  <Badge variant="success">this device</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutate(s.id)}
                    title="Revoke session"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
