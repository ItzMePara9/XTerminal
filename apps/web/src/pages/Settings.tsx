import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, UserRound } from "lucide-react";
import { api, HttpError } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@xterminal/ui";

export default function SettingsPage() {
  const { user, refresh } = useAuthStore();
  const [name, setName] = useState(user?.name ?? "");
  const [nameSaved, setNameSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const saveProfile = useMutation({
    mutationFn: () => api.updateProfile(name.trim()),
    onSuccess: () => {
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
      void refresh();
    },
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirm) throw new Error("New passwords do not match");
      await api.changePassword(currentPassword, newPassword);
    },
    onSuccess: () => {
      setPwMessage({ ok: true, text: "Password changed." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    },
    onError: (err) =>
      setPwMessage({
        ok: false,
        text: err instanceof HttpError || err instanceof Error ? err.message : "Failed",
      }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-500">Profile and account preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={user?.email ?? ""} disabled />
          </div>
          <div>
            <Label htmlFor="name">Display name</Label>
            <div className="flex gap-2">
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              <Button onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
                {saveProfile.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : nameSaved ? (
                  "Saved"
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="current-pw">Current password</Label>
            <Input
              id="current-pw"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="new-pw">New password</Label>
              <Input
                id="new-pw"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="confirm-pw">Confirm new password</Label>
              <Input
                id="confirm-pw"
                type="password"
                autoComplete="new-password"
                minLength={10}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
          {pwMessage && (
            <p
              className={`rounded-lg border px-3 py-2 text-xs ${
                pwMessage.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              {pwMessage.text}
            </p>
          )}
          <Button
            onClick={() => changePassword.mutate()}
            disabled={
              changePassword.isPending || !currentPassword || newPassword.length < 10
            }
          >
            {changePassword.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update password
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Terminal preferences</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-slate-400">
            Terminal appearance (font size, theme, split view) is adjusted from the terminal
            toolbar and remembered per browser. Keyboard shortcuts:{" "}
            <kbd className="rounded border border-edge bg-[#161d29] px-1.5 py-0.5 text-xs">
              Ctrl K
            </kbd>{" "}
            opens the command palette.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
