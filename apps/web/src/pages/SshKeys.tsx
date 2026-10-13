import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgePlus, FileKey2, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { api, HttpError } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Label,
  Spinner,
  Textarea,
} from "@xterminal/ui";
import { formatDate } from "@/lib/utils";

export default function SshKeysPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["ssh-keys"], queryFn: api.sshKeys });
  const { data: certsData } = useQuery({ queryKey: ["certificates"], queryFn: api.certificates });

  const create = useMutation({
    mutationFn: () =>
      api.createSshKey({ name: name.trim(), privateKey, passphrase: passphrase || undefined }),
    onSuccess: () => {
      setAdding(false);
      setName("");
      setPrivateKey("");
      setPassphrase("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["ssh-keys"] });
    },
    onError: (err) =>
      setError(err instanceof HttpError ? err.message : "Failed to save key"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSshKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ssh-keys"] }),
  });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">SSH Keys</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Encrypted private keys (ED25519, RSA, ECDSA) for connection authentication
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add Key
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (data?.keys ?? []).length === 0 ? (
        <EmptyState
          icon={<FileKey2 className="h-10 w-10" />}
          title="No SSH keys saved"
          description="Upload or paste a private key to reuse it across connections. Keys are encrypted at rest."
          action={<Button onClick={() => setAdding(true)}>+ Add Key</Button>}
        />
      ) : (
        <div className="space-y-2">
          {data!.keys.map((k) => (
            <Card key={k.id} className="flex items-center gap-3 px-4 py-3">
              <FileKey2 className="h-5 w-5 shrink-0 text-cyan-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-200">{k.name}</span>
                  {k.keyType && <Badge variant="accent">{k.keyType}</Badge>}
                  {k.hasPassphrase && <Badge variant="violet">passphrase</Badge>}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
                  {k.fingerprint ?? "fingerprint unavailable"}
                </div>
              </div>
              <span className="hidden text-xs text-slate-600 sm:inline">{formatDate(k.createdAt)}</span>
              <Button size="icon" variant="ghost" title="Delete" onClick={() => remove.mutate(k.id)}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      {(certsData?.certificates ?? []).length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-sm font-semibold uppercase tracking-wider text-slate-500">
            SSH Certificates
          </h2>
          <div className="space-y-2">
            {certsData!.certificates.map((c) => (
              <Card key={c.id} className="flex items-center gap-3 px-4 py-3">
                <ShieldCheck className="h-5 w-5 shrink-0 text-violet-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-200">{c.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {c.keyName ? `key: ${c.keyName}` : "no key associated"}
                  </div>
                </div>
                <span className="hidden text-xs text-slate-600 sm:inline">{formatDate(c.createdAt)}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Delete"
                  onClick={() => api.deleteCertificate(c.id).then(() => queryClient.invalidateQueries({ queryKey: ["certificates"] }))}
                >
                  <Trash2 className="h-4 w-4 text-red-400" />
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add SSH key"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || !privateKey.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgePlus className="h-4 w-4" />}
              Save key
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ed25519-laptop"
            />
          </div>
          <div>
            <Label htmlFor="key-body">Private key</Label>
            <Textarea
              id="key-body"
              rows={7}
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
            />
            <p className="mt-1.5 text-xs text-slate-600">
              Paste an OpenSSH, PEM (RSA) or ECDSA private key. Keys are encrypted with
              AES-256-GCM before storage and never sent back to the browser.
            </p>
          </div>
          <div>
            <Label htmlFor="key-pass">Passphrase (if the key is encrypted)</Label>
            <Input
              id="key-pass"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
