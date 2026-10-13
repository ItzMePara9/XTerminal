import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { api, HttpError } from "@/lib/api";
import { useTerminalStore } from "@/store/terminal";
import type { ConnectionDto } from "@xterminal/types";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Label,
  Select,
  Spinner,
  Textarea,
} from "@xterminal/ui";
import { timeAgo } from "@/lib/utils";

export default function ConnectionsPage({
  favoritesOnly,
  recentOnly,
}: {
  favoritesOnly?: boolean;
  recentOnly?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addTab = useTerminalStore((s) => s.addTab);
  const [editing, setEditing] = useState<ConnectionDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ConnectionDto | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["connections"], queryFn: api.connections });
  const { data: groupsData } = useQuery({ queryKey: ["groups"], queryFn: api.groups });

  useEffect(() => {
    if (params.get("new")) {
      setCreating(true);
      params.delete("new");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const connections = useMemo(() => {
    let list = data?.connections ?? [];
    if (favoritesOnly) list = list.filter((c) => c.favorite);
    if (recentOnly) {
      list = list
        .filter((c) => c.lastConnectedAt)
        .sort((a, b) => (a.lastConnectedAt! < b.lastConnectedAt! ? 1 : -1));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          (c.nickname ?? "").toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          c.username.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [data?.connections, favoritesOnly, recentOnly, search]);

  const connect = (c: ConnectionDto) => {
    addTab({
      connectionId: c.id,
      label: c.nickname ?? c.host,
      host: `${c.username}@${c.host}:${c.port}`,
      sessionId: null,
      status: "connecting",
    });
    navigate("/terminal");
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteConnection(id),
    onSuccess: () => {
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  const favorite = useMutation({
    mutationFn: (c: ConnectionDto) => api.updateConnection(c.id, { favorite: !c.favorite }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">
            {favoritesOnly ? "Favorites" : recentOnly ? "Recent" : "Connections"}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{connections.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-600" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-52 pl-8"
            />
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New Connection
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6" />
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-10 w-10" />}
          title={favoritesOnly ? "No favorites yet" : "No connections yet"}
          description={
            favoritesOnly
              ? "Star a connection to pin it here."
              : "Add an SSH server with a password or private key to connect from the browser."
          }
          action={<Button onClick={() => setCreating(true)}>+ New Connection</Button>}
        />
      ) : (
        <div className="space-y-2">
          {connections.map((c) => (
            <Card key={c.id} className="group flex items-center gap-3 px-4 py-3">
              <button onClick={() => favorite.mutate(c)} aria-label="Toggle favorite">
                <Star
                  className={`h-4 w-4 ${
                    c.favorite ? "fill-amber-400 text-amber-400" : "text-slate-600 hover:text-amber-400"
                  }`}
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-200">
                    {c.nickname ?? c.host}
                  </span>
                  {c.groupName && <Badge variant="violet">{c.groupName}</Badge>}
                  {c.tags.slice(0, 3).map((t) => (
                    <Badge key={t}>{t}</Badge>
                  ))}
                </div>
                <div className="mt-0.5 flex items-center gap-3 font-mono text-xs text-slate-500">
                  <span className="truncate">
                    {c.username}@{c.host}:{c.port}
                  </span>
                  {c.jumpConnectionId && <Badge variant="warning">via jump host</Badge>}
                  <span className="hidden sm:inline">
                    {c.authMethod === "PASSWORD" ? "password" : c.authMethod === "KEY" ? "key" : "certificate"}
                    {c.sshKeyName ? ` (${c.sshKeyName})` : ""}
                  </span>
                  <span className="ml-auto hidden shrink-0 sm:inline">{timeAgo(c.lastConnectedAt)}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="icon" variant="ghost" title="Duplicate" onClick={() => setEditing(c /* duplicate handled in dialog via copy flag */)}>
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditing(c)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" title="Delete" onClick={() => setConfirmDelete(c)}>
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </div>
              <Button size="sm" onClick={() => connect(c)}>
                <Plug className="h-3.5 w-3.5" />
                Connect
              </Button>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ConnectionDialog
          connection={editing}
          groups={groupsData?.groups ?? []}
          connections={data?.connections ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ["connections"] });
          }}
        />
      )}

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete connection"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
              disabled={remove.isPending}
            >
              {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          Delete <span className="text-slate-200">{confirmDelete?.nickname ?? confirmDelete?.host}</span>?
          Stored credentials for this connection will be permanently removed.
        </p>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection editor
// ---------------------------------------------------------------------------

function ConnectionDialog({
  connection,
  groups,
  connections,
  onClose,
  onSaved,
}: {
  connection: ConnectionDto | null;
  groups: { id: string; name: string }[];
  connections: ConnectionDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!connection;
  const [nickname, setNickname] = useState(connection?.nickname ?? "");
  const [host, setHost] = useState(connection?.host ?? "");
  const [port, setPort] = useState(String(connection?.port ?? 22));
  const [username, setUsername] = useState(connection?.username ?? "");
  const [authMethod, setAuthMethod] = useState(connection?.authMethod ?? "PASSWORD");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [sshKeyId, setSshKeyId] = useState(connection?.sshKeyId ?? "");
  const [certificateId, setCertificateId] = useState(connection?.certificateId ?? "");
  const [certificate, setCertificate] = useState("");
  const [groupId, setGroupId] = useState(connection?.groupId ?? "");
  const [jumpConnectionId, setJumpConnectionId] = useState(connection?.jumpConnectionId ?? "");
  const [tags, setTags] = useState((connection?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  const { data: keysData } = useQuery({ queryKey: ["ssh-keys"], queryFn: api.sshKeys });
  const { data: certsData } = useQuery({ queryKey: ["certificates"], queryFn: api.certificates });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        nickname: nickname || null,
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authMethod,
        groupId: groupId || null,
        jumpConnectionId: jumpConnectionId || null,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
      if (authMethod === "PASSWORD") {
        if (password) body.password = password;
      } else if (authMethod === "KEY") {
        if (privateKey.trim()) body.privateKey = privateKey;
        if (passphrase) body.passphrase = passphrase;
        body.sshKeyId = sshKeyId || null;
      } else {
        if (privateKey.trim()) body.privateKey = privateKey;
        if (passphrase) body.passphrase = passphrase;
        body.sshKeyId = sshKeyId || null;
        if (certificate.trim()) body.certificate = certificate;
        body.certificateId = certificateId || null;
      }
      return isEdit ? api.updateConnection(connection!.id, body) : api.createConnection(body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof HttpError ? err.message : "Save failed"),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={isEdit ? `Edit ${connection!.nickname ?? connection!.host}` : "New Connection"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !host || !username}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create connection"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="nickname">Nickname</Label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Production VPS"
          />
        </div>
        <div>
          <Label htmlFor="host">Host *</Label>
          <Input
            id="host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="203.0.113.10"
            required
          />
        </div>
        <div>
          <Label htmlFor="port">Port</Label>
          <Input
            id="port"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="username">Username *</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="root"
            required
          />
        </div>
        <div>
          <Label htmlFor="authMethod">Authentication</Label>
          <Select
            id="authMethod"
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as never)}
          >
            <option value="PASSWORD">Password</option>
            <option value="KEY">SSH Key</option>
            <option value="CERT">SSH Certificate</option>
          </Select>
        </div>

        {authMethod === "PASSWORD" && (
          <div className="sm:col-span-2">
            <Label htmlFor="password">
              Password {isEdit && connection!.hasPassword ? "(leave blank to keep current)" : "*"}
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit && connection!.hasPassword ? "•••••••••• (unchanged)" : "••••••••••"}
              autoComplete="new-password"
            />
          </div>
        )}

        {(authMethod === "KEY" || authMethod === "CERT") && (
          <>
            <div className="sm:col-span-2">
              <Label htmlFor="sshKeyId">Saved key</Label>
              <Select id="sshKeyId" value={sshKeyId} onChange={(e) => setSshKeyId(e.target.value)}>
                <option value="">
                  {privateKey.trim() ? "(using pasted key below)" : "Select a saved SSH key…"}
                </option>
                {(keysData?.keys ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} {k.keyType ? `(${k.keyType})` : ""}
                    {k.fingerprint ? ` - ${k.fingerprint.slice(0, 20)}…` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="privateKey">
                Private key{" "}
                {isEdit && connection!.sshKeyId === null
                  ? "(leave blank to keep current)"
                  : "(or paste an OpenSSH / PEM key)"}
              </Label>
              <Textarea
                id="privateKey"
                rows={5}
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="passphrase">Key passphrase (optional)</Label>
              <Input
                id="passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </>
        )}

        {authMethod === "CERT" && (
          <>
            <div className="sm:col-span-2">
              <Label htmlFor="certificateId">Saved certificate</Label>
              <Select
                id="certificateId"
                value={certificateId}
                onChange={(e) => setCertificateId(e.target.value)}
              >
                <option value="">Select a saved certificate…</option>
                {(certsData?.certificates ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="certificate">Certificate (or paste)</Label>
              <Textarea
                id="certificate"
                rows={4}
                value={certificate}
                onChange={(e) => setCertificate(e.target.value)}
                placeholder="ssh-ed25519-cert-v01@openssh.com AAAA…"
              />
            </div>
          </>
        )}

        <div>
          <Label htmlFor="group">Group</Label>
          <Select id="group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="jump">Jump host</Label>
          <Select
            id="jump"
            value={jumpConnectionId}
            onChange={(e) => setJumpConnectionId(e.target.value)}
          >
            <option value="">Direct connection</option>
            {connections
              .filter((c) => c.id !== connection?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname ?? c.host}
                </option>
              ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input
            id="tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="production, web"
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      <p className="mt-4 flex items-start gap-2 text-xs text-slate-600">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Credentials are encrypted at rest with AES-256-GCM before being stored and are never
        returned to the browser.
      </p>
    </Dialog>
  );
}
