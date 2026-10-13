import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@xterminal/ui";
import { api, HttpError } from "@/lib/api";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState("error");
      setMessage("Missing verification token.");
      return;
    }
    api
      .verifyEmail(token)
      .then(() => setState("ok"))
      .catch((err) => {
        setState("error");
        setMessage(err instanceof HttpError ? err.message : "Verification failed");
      });
  }, [token]);

  return (
    <AuthLayout title="Email verification">
      <div className="flex flex-col items-center py-4 text-center">
        {state === "pending" && (
          <>
            <Loader2 className="mb-4 h-10 w-10 animate-spin text-cyan-400" />
            <p className="text-sm text-slate-400">Verifying your email address…</p>
          </>
        )}
        {state === "ok" && (
          <>
            <CheckCircle2 className="mb-4 h-10 w-10 text-emerald-400" />
            <p className="text-sm text-slate-300">Your email address has been verified.</p>
            <Link to="/login" className="mt-4">
              <Button>Sign in</Button>
            </Link>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle className="mb-4 h-10 w-10 text-red-400" />
            <p className="text-sm text-slate-400">{message}</p>
            <Link to="/login" className="mt-4 text-xs text-cyan-400 hover:text-cyan-300">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
