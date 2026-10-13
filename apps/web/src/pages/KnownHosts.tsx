import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Spinner } from "@xterminal/ui";
import { formatDate } from "@/lib/utils";

export default function KnownHostsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["known-hosts"], queryFn: api.knownHosts });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteKnownHost(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["known-hosts"] }),
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Known Hosts</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          SSH host keys you have trusted. If a server's key changes, XTerminal refuses to connect
          until you remove the stale entry and re-verify.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (data?.knownHosts ?? []).length === 0 ? (
        <EmptyState
          icon={<ShieldOff className="h-10 w-10" />}
          title="No known hosts yet"
          description="Host keys are added here when you choose 'Trust & Save' while connecting to a new server."
        />
      ) : (
        <div className="space-y-2">
          {data!.knownHosts.map((h) => (
            <Card key={h.id} className="flex items-center gap-3 px-4 py-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-slate-200">
                    {h.host}:{h.port}
                  </span>
                  <Badge variant="accent">{h.keyType}</Badge>
                </div>
                <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
                  {h.fingerprint}
                </div>
              </div>
              <span className="hidden text-xs text-slate-600 sm:inline">
                trusted {formatDate(h.trustedAt)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                title="Remove known host"
                onClick={() => remove.mutate(h.id)}
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
