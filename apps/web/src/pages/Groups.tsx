import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, FolderTree, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Label,
  Spinner,
} from "@xterminal/ui";

export default function GroupsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; color: string | null } | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["groups"], queryFn: api.groups });

  useEffect(() => {
    if (params.get("new")) {
      setCreating(true);
      params.delete("new");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const create = useMutation({
    mutationFn: () => api.createGroup(name.trim(), color || undefined),
    onSuccess: () => {
      setCreating(false);
      setName("");
      setColor("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create group"),
  });

  const update = useMutation({
    mutationFn: () => api.updateGroup(editing!.id, { name: name.trim(), color: color || null }),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGroup(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["groups"] }),
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Groups</h1>
          <p className="mt-0.5 text-sm text-slate-500">Organize connections into collections</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New Group
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (data?.groups ?? []).length === 0 ? (
        <EmptyState
          icon={<FolderTree className="h-10 w-10" />}
          title="No groups yet"
          description="Create groups like Production, Development or Databases to organize connections."
          action={<Button onClick={() => setCreating(true)}>+ New Group</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data!.groups.map((g) => (
            <Card key={g.id} className="flex items-center gap-3 px-4 py-3">
              <div
                className="h-8 w-1.5 rounded-full"
                style={{ background: g.color ?? "#22d3ee" }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-200">{g.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {g.connectionCount} connection{g.connectionCount === 1 ? "" : "s"}
                </div>
              </div>
              <Badge variant="default">{g.connectionCount}</Badge>
              <Button
                size="icon"
                variant="ghost"
                title="Rename"
                onClick={() => {
                  setEditing({ id: g.id, name: g.name, color: g.color });
                  setName(g.name);
                  setColor(g.color ?? "");
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                title="Delete group"
                onClick={() => remove.mutate(g.id)}
              >
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={creating || !!editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          setError(null);
        }}
        title={editing ? "Edit group" : "New group"}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => (editing ? update.mutate() : create.mutate())}
            >
              {create.isPending || update.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderPlus className="h-4 w-4" />
              )}
              {editing ? "Save" : "Create"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Production"
            />
          </div>
          <div>
            <Label htmlFor="group-color">Color (hex)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="group-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#22d3ee"
              />
              <div
                className="h-9 w-9 shrink-0 rounded-lg border border-edge"
                style={{ background: color || "#22d3ee" }}
              />
            </div>
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
