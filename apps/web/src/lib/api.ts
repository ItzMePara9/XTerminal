import type {
  AuthSessionDto,
  ConnectionDto,
  ConnectionGroupDto,
  KnownHostDto,
  SecurityKeyDto,
  SshCertificateDto,
  SshKeyDto,
  TerminalTicket,
  UserPublic,
} from "@xterminal/types";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new HttpError(
      res.status,
      (data.error as string) ?? "ERROR",
      (data.message as string) ?? res.statusText,
    );
  }
  return data as T;
}

export const api = {
  // auth
  register: (body: { email: string; password: string; name?: string }) =>
    request<{ user?: UserPublic; message?: string; emailSent?: boolean }>(
      "POST",
      "/api/auth/register",
      body,
    ),
  login: (body: { email: string; password: string; totpCode?: string }) =>
    request<{ user: UserPublic }>("POST", "/api/auth/login", body),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
  me: () => request<{ user: UserPublic }>("GET", "/api/auth/me"),
  sessions: () => request<{ sessions: AuthSessionDto[] }>("GET", "/api/auth/sessions"),
  revokeSession: (id: string) => request<{ ok: boolean }>("DELETE", `/api/auth/sessions/${id}`),
  logoutAll: () => request<{ ok: boolean }>("POST", "/api/auth/sessions/logout-all"),
  forgotPassword: (email: string) =>
    request<{ ok: boolean }>("POST", "/api/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>("POST", "/api/auth/reset-password", { token, password }),
  verifyEmail: (token: string) =>
    request<{ ok: boolean }>("POST", "/api/auth/verify-email", { token }),
  resendVerification: (email: string) =>
    request<{ ok: boolean }>("POST", "/api/auth/resend-verification", { email }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("POST", "/api/auth/change-password", {
      currentPassword,
      newPassword,
    }),
  updateProfile: (name: string) =>
    request<{ user: Pick<UserPublic, "id" | "email" | "name"> }>("PATCH", "/api/auth/profile", { name }),

  // totp
  totpSetup: () => request<{ secret: string; uri: string }>("POST", "/api/auth/totp/setup"),
  totpEnable: (code: string) => request<{ ok: boolean }>("POST", "/api/auth/totp/enable", { code }),
  totpDisable: (code: string) => request<{ ok: boolean }>("POST", "/api/auth/totp/disable", { code }),

  // webauthn
  webauthnRegisterOptions: () =>
    request<Record<string, unknown>>("GET", "/api/security-keys/register/options"),
  webauthnRegister: (name: string, response: unknown) =>
    request<{ ok: boolean }>("POST", "/api/security-keys/register", { name, response }),
  webauthnAuthOptions: (email?: string) =>
    request<{ requestId: string; options: Record<string, unknown> }>(
      "POST",
      "/api/auth/webauthn/options",
      email ? { email } : {},
    ),
  webauthnVerify: (requestId: string, email: string | undefined, response: unknown) =>
    request<{ user: UserPublic }>("POST", "/api/auth/webauthn/verify", {
      requestId,
      email,
      response,
    }),
  securityKeys: () => request<{ keys: SecurityKeyDto[] }>("GET", "/api/security-keys"),
  renameSecurityKey: (id: string, name: string) =>
    request<{ ok: boolean }>("PATCH", `/api/security-keys/${id}`, { name }),
  deleteSecurityKey: (id: string) =>
    request<{ ok: boolean }>("DELETE", `/api/security-keys/${id}`),

  // connections
  connections: () => request<{ connections: ConnectionDto[] }>("GET", "/api/connections"),
  connection: (id: string) => request<{ connection: ConnectionDto }>("GET", `/api/connections/${id}`),
  createConnection: (body: unknown) =>
    request<{ connection: ConnectionDto }>("POST", "/api/connections", body),
  updateConnection: (id: string, body: unknown) =>
    request<{ connection: ConnectionDto }>("PATCH", `/api/connections/${id}`, body),
  deleteConnection: (id: string) => request<{ ok: boolean }>("DELETE", `/api/connections/${id}`),

  // groups
  groups: () => request<{ groups: ConnectionGroupDto[] }>("GET", "/api/groups"),
  createGroup: (name: string, color?: string) =>
    request<{ group: ConnectionGroupDto }>("POST", "/api/groups", { name, color }),
  updateGroup: (id: string, body: { name?: string; color?: string | null }) =>
    request<{ ok: boolean }>("PATCH", `/api/groups/${id}`, body),
  deleteGroup: (id: string) => request<{ ok: boolean }>("DELETE", `/api/groups/${id}`),

  // tags
  tags: () => request<{ tags: { id: string; name: string }[] }>("GET", "/api/tags"),
  deleteTag: (id: string) => request<{ ok: boolean }>("DELETE", `/api/tags/${id}`),

  // ssh keys
  sshKeys: () => request<{ keys: SshKeyDto[] }>("GET", "/api/ssh-keys"),
  createSshKey: (body: { name: string; privateKey: string; passphrase?: string }) =>
    request<{ key: SshKeyDto }>("POST", "/api/ssh-keys", body),
  deleteSshKey: (id: string) => request<{ ok: boolean }>("DELETE", `/api/ssh-keys/${id}`),

  // certificates
  certificates: () => request<{ certificates: SshCertificateDto[] }>("GET", "/api/certificates"),
  createCertificate: (body: { name: string; certificate: string; keyId?: string }) =>
    request<{ certificate: SshCertificateDto }>("POST", "/api/certificates", body),
  deleteCertificate: (id: string) =>
    request<{ ok: boolean }>("DELETE", `/api/certificates/${id}`),

  // known hosts
  knownHosts: () => request<{ knownHosts: KnownHostDto[] }>("GET", "/api/known-hosts"),
  deleteKnownHost: (id: string) => request<{ ok: boolean }>("DELETE", `/api/known-hosts/${id}`),

  // terminal
  openSession: (connectionId: string, cols?: number, rows?: number) =>
    request<TerminalTicket>("POST", `/api/connections/${connectionId}/session`, { cols, rows }),
  reattach: (sessionId: string) =>
    request<TerminalTicket>("POST", `/api/terminal/${sessionId}/reattach`),
  listTerminals: () =>
    request<{ sessions: { sessionId: string; connectionId: string; label: string; status: string }[] }>(
      "GET",
      "/api/terminal",
    ),
  terminateTerminal: (sessionId: string) =>
    request<{ ok: boolean }>("DELETE", `/api/terminal/${sessionId}`),
};
