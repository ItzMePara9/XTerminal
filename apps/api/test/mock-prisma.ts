/**
 * In-memory Prisma mock used by API tests.
 *
 * It honors the subset of Prisma query semantics the app relies on
 * (equality/null `where` fields, `gt` on dates, compound uniques for upserts,
 * the relation `include`s used by the routes) so route-level ownership
 * filtering and CRUD logic are exercised for real. It does NOT replace
 * database-level constraints (uniques, cascades) — those are covered by the
 * real PostgreSQL deployment via docker-compose.
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("gt" in (cond as object)) {
        if (!(row[key] instanceof Date) || (row[key] as Date) <= (cond as { gt: Date }).gt) {
          return false;
        }
        continue;
      }
      // Compound unique key, e.g. { userId, name }
      let compoundOk = true;
      for (const [k2, v2] of Object.entries(cond as Row)) {
        if (row[k2] !== v2) compoundOk = false;
      }
      if (!compoundOk) return false;
      continue;
    }
    // Prisma treats an absent (undefined) column as null in equality filters.
    const isNil = (v: unknown) => v === undefined || v === null;
    if (row[key] !== cond && !(isNil(row[key]) && isNil(cond))) return false;
  }
  return true;
}

function applyNestedCreate(table: Table, data: Row): Row {
  // connection.create({ data: { ..., tags: { create: [{ tagId }] } } })
  const tagsCreate = (data.tags as { create?: { tagId: string }[] } | undefined)?.create;
  const clean = { ...data };
  delete clean.tags;
  const row = table.create(clean);
  if (tagsCreate) {
    for (const link of tagsCreate) {
      mockTables.tagOnConnection.create({ connectionId: row.id, tagId: link.tagId });
    }
  }
  return row;
}

export class Table {
  rows: Row[] = [];
  private seq = 0;

  constructor(private readonly name: string) {}

  private newId(): string {
    this.seq += 1;
    return `${this.name}_${this.seq.toString().padStart(4, "0")}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  create(data: Row): Row {
    const now = new Date();
    const row: Row = {
      id: this.newId(),
      createdAt: now,
      updatedAt: now,
      ...structuredClone(data),
    };
    this.rows.push(row);
    return row;
  }

  createMany({ data }: { data: Row[] }): { count: number } {
    for (const d of data) this.create(d);
    return { count: data.length };
  }

  findFirst(args?: { where?: Row }): Row | null {
    const where = args?.where ?? {};
    return this.rows.find((r) => matches(r, where)) ?? null;
  }

  findUnique(args: { where: Row }): Row | null {
    return this.rows.find((r) => matches(r, args.where)) ?? null;
  }

  findUniqueOrThrow(args: { where: Row }): Row {
    const row = this.findUnique(args);
    if (!row) throw new Error(`${this.name} not found`);
    return row;
  }

  findMany(args?: { where?: Row; orderBy?: unknown }): Row[] {
    const where = args?.where ?? {};
    return this.rows.filter((r) => matches(r, where));
  }

  count(args?: { where?: Row }): number {
    return this.findMany(args).length;
  }

  update(args: { where: Row; data: Row }): Row {
    const row = this.findUnique({ where: args.where });
    if (!row) throw new Error(`${this.name} not found`);
    Object.assign(row, structuredClone(args.data), { updatedAt: new Date() });
    return row;
  }

  updateMany(args: { where: Row; data: Row }): { count: number } {
    const rows = this.findMany({ where: args.where });
    for (const row of rows) {
      Object.assign(row, structuredClone(args.data), { updatedAt: new Date() });
    }
    return { count: rows.length };
  }

  delete(args: { where: Row }): Row {
    const row = this.findUnique({ where: args.where });
    if (!row) throw new Error(`${this.name} not found`);
    this.rows = this.rows.filter((r) => r !== row);
    return row;
  }

  deleteMany(args?: { where?: Row }): { count: number } {
    const rows = this.findMany({ where: args?.where ?? {} });
    this.rows = this.rows.filter((r) => !rows.includes(r));
    return { count: rows.length };
  }

  upsert(args: { where: Row; update: Row; create: Row }): Row {
    const existing = this.findUnique({ where: args.where });
    if (existing) {
      Object.assign(existing, structuredClone(args.update), { updatedAt: new Date() });
      return existing;
    }
    return this.create(args.create);
  }
}

export const mockTables = {
  user: new Table("user"),
  authSession: new Table("authSession"),
  connection: new Table("connection"),
  connectionGroup: new Table("connectionGroup"),
  sshKey: new Table("sshKey"),
  sshCertificate: new Table("sshCertificate"),
  knownHost: new Table("knownHost"),
  tag: new Table("tag"),
  tagOnConnection: new Table("tagOnConnection"),
  webAuthnCredential: new Table("webAuthnCredential"),
  auditLog: new Table("auditLog"),
};

/** Relation includes used by the app's routes. */
function attachIncludes(model: string, row: Row, include?: Row): Row {
  if (!include) return row;
  const out: Row = { ...row };
  if (model === "authSession" && (include as Row).user) {
    out.user = mockTables.user.findUnique({ where: { id: row.userId as string } });
  }
  if (model === "connection") {
    const inc = include as Row;
    if (inc.group) out.group = row.groupId ? mockTables.connectionGroup.findUnique({ where: { id: row.groupId as string } }) : null;
    if (inc.sshKey) out.sshKey = row.sshKeyId ? mockTables.sshKey.findUnique({ where: { id: row.sshKeyId as string } }) : null;
    if (inc.certificate) out.certificate = row.certificateId ? mockTables.sshCertificate.findUnique({ where: { id: row.certificateId as string } }) : null;
    if (inc.jumpConnection) out.jumpConnection = row.jumpConnectionId ? mockTables.connection.findUnique({ where: { id: row.jumpConnectionId as string } }) : null;
    if (inc.tags) {
      out.tags = mockTables.tagOnConnection
        .findMany({ where: { connectionId: row.id as string } })
        .map((link) => ({
          ...link,
          tag: mockTables.tag.findUnique({ where: { id: link.tagId as string } }),
        }));
    }
  }
  if (model === "connectionGroup") {
    const inc = include as Row;
    if (inc._count) {
      out._count = { connections: mockTables.connection.count({ where: { groupId: row.id as string } }) };
    }
  }
  return out;
}

function withIncludes(model: string) {
  const table = mockTables[model as keyof typeof mockTables] as Table;
  return {
    create: (args: { data: Row }) =>
      model === "connection" ? applyNestedCreate(table, args.data) : table.create(args.data),
    createMany: (args: { data: Row[] }) => table.createMany(args),
    findFirst: (args?: { where?: Row; include?: Row }) => {
      const row = table.findFirst(args);
      return row ? attachIncludes(model, row, args?.include) : null;
    },
    findUnique: (args: { where: Row; include?: Row }) => {
      const row = table.findUnique(args);
      return row ? attachIncludes(model, row, args.include) : null;
    },
    findUniqueOrThrow: (args: { where: Row; include?: Row }) =>
      attachIncludes(model, table.findUniqueOrThrow(args), args.include),
    findMany: (args?: { where?: Row; orderBy?: unknown; include?: Row }) =>
      table.findMany(args).map((r) => attachIncludes(model, r, args?.include)),
    count: (args?: { where?: Row }) => table.count(args),
    update: (args: { where: Row; data: Row; include?: Row }) =>
      attachIncludes(model, table.update(args), args.include),
    updateMany: (args: { where: Row; data: Row }) => table.updateMany(args),
    delete: (args: { where: Row }) => table.delete(args),
    deleteMany: (args?: { where?: Row }) => table.deleteMany(args),
    upsert: (args: { where: Row; update: Row; create: Row }) => table.upsert(args),
  };
}

export function createMockPrisma(): Record<string, ReturnType<typeof withIncludes>> {
  return {
    user: withIncludes("user"),
    authSession: withIncludes("authSession"),
    connection: withIncludes("connection"),
    connectionGroup: withIncludes("connectionGroup"),
    sshKey: withIncludes("sshKey"),
    sshCertificate: withIncludes("sshCertificate"),
    knownHost: withIncludes("knownHost"),
    tag: withIncludes("tag"),
    tagOnConnection: withIncludes("tagOnConnection"),
    webAuthnCredential: withIncludes("webAuthnCredential"),
    auditLog: withIncludes("auditLog"),
  };
}
