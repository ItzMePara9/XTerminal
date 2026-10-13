import { useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MailCheck } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Input, Label } from "@xterminal/ui";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex flex-col items-center py-4 text-center">
          <MailCheck className="mb-4 h-10 w-10 text-cyan-400" />
          <p className="text-sm text-slate-400">
            If an account exists for <span className="text-slate-200">{email}</span>, a
            password reset link has been sent. The link expires in 1 hour.
          </p>
        </div>
        <Link
          to="/login"
          className="mt-4 block text-center text-xs text-cyan-400 hover:text-cyan-300"
        >
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a reset link">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Send reset link
        </Button>
      </form>
      <p className="mt-5 text-center text-xs text-slate-500">
        <Link to="/login" className="text-cyan-400 hover:text-cyan-300">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
