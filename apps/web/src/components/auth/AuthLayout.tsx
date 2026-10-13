import { Terminal } from "lucide-react";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 ring-1 ring-cyan-500/30">
            <Terminal className="h-6 w-6 text-cyan-400" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="glass rounded-2xl border border-edge p-6 shadow-2xl shadow-black/40">
          {children}
        </div>
      </div>
    </div>
  );
}
