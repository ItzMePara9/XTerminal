import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Plus, Star, Terminal as TerminalIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useTerminalStore } from "@/store/terminal";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from "@xterminal/ui";
import { timeAgo } from "@/lib/utils";

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const addTab = useTerminalStore((s) => s.addTab);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["connections"], queryFn: api.connections });

  const connect = useMutation({
    mutationFn: async (connectionId: string) => {
      const c = data?.connections.find((x) => x.id === connectionId);
      // Open the terminal tab; the tab itself opens the session + WS.
      return c!;
    },
    onSuccess: (c) => {
      if (!c) return;
      addTab({
        connectionId: c.id,
        label: c.nickname ?? c.host,
        host: `${c.username}@${c.host}:${c.port}`,
        sessionId: null,
        status: "connecting",
      });
      navigate("/terminal");
    },
  });

  const favorite = useMutation({
    mutationFn: (c: { id: string; favorite: boolean }) =>
      api.updateConnection(c.id, { favorite: !c.favorite }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections"] }),
  });

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const connections = data?.connections ?? [];
  const recent = connections
    .filter((c) => c.lastConnectedAt)
    .sort((a, b) => (a.lastConnectedAt! < b.lastConnectedAt! ? 1 : -1))
    .slice(0, 6);
  const favorites = connections.filter((c) => c.favorite).slice(0, 6);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            {greeting}
            {user?.name ? `, ${user.name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {connections.length} connection{connections.length === 1 ? "" : "s"} ·{" "}
            {favorites.length} favorite{favorites.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button onClick={() => navigate("/connections?new=1")}>
          <Plus className="h-4 w-4" />
          New Connection
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6" />
        </div>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={<TerminalIcon className="h-10 w-10" />}
          title="No connections yet"
          description="Add your first SSH server to start a terminal session from the browser."
          action={<Button onClick={() => navigate("/connections?new=1")}>+ New Connection</Button>}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {recent.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Connections</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 p-3">
                {recent.map((c) => (
                  <ConnectionRow key={c.id} connection={c} onConnect={() => connect.mutate(c.id)} onFavorite={() => favorite.mutate(c)} />
                ))}
              </CardBody>
            </Card>
          )}
          {favorites.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Favorites</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 p-3">
                {favorites.map((c) => (
                  <ConnectionRow key={c.id} connection={c} onConnect={() => connect.mutate(c.id)} onFavorite={() => favorite.mutate(c)} />
                ))}
              </CardBody>
            </Card>
          )}
          {recent.length === 0 && favorites.length === 0 && (
            <Card className="md:col-span-2">
              <CardBody className="space-y-2 p-3">
                {connections.slice(0, 8).map((c) => (
                  <ConnectionRow key={c.id} connection={c} onConnect={() => connect.mutate(c.id)} onFavorite={() => favorite.mutate(c)} />
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionRow({
  connection,
  onConnect,
  onFavorite,
}: {
  connection: NonNullable<Awaited<ReturnType<typeof api.connections>>>["connections"][number];
  onConnect: () => void;
  onFavorite: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-edge hover:bg-white/[0.02]">
      <button
        onClick={onFavorite}
        className="shrink-0"
        aria-label={connection.favorite ? "Unfavorite" : "Favorite"}
      >
        <Star
          className={`h-4 w-4 ${
            connection.favorite
              ? "fill-amber-400 text-amber-400"
              : "text-slate-600 hover:text-amber-400"
          }`}
        />
      </button>
      <button onClick={onConnect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-slate-200">
            {connection.nickname ?? connection.host}
          </div>
          <div className="truncate font-mono text-xs text-slate-500">
            {connection.username}@{connection.host}:{connection.port}
          </div>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          {connection.groupName && <Badge variant="violet">{connection.groupName}</Badge>}
          <Badge variant={connection.authMethod === "PASSWORD" ? "default" : "accent"}>
            {connection.authMethod === "PASSWORD" ? "Password" : connection.authMethod === "KEY" ? "Key" : "Cert"}
          </Badge>
          <span className="text-xs text-slate-600">{timeAgo(connection.lastConnectedAt)}</span>
        </div>
      </button>
      <Button size="sm" variant="secondary" onClick={onConnect} className="opacity-0 transition-opacity group-hover:opacity-100">
        <Plug className="h-3.5 w-3.5" />
        Connect
      </Button>
    </div>
  );
}
