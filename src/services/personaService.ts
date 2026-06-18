import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { db, brandPersonas, orgBrands } from '../db';

export type PersonaStatus = 'active' | 'paused' | 'archived';

export interface Persona {
  id: string;
  brandId: string;
  name: string;
  filters: Record<string, string[]>;
  status: PersonaStatus;
  avatarUrl: string | null;
  createdAt: string;
}

/**
 * Cross-cutting persona shape for the internal enumeration endpoint: the persona
 * stamped with its owning org (resolved from org_brands). No avatar/createdAt —
 * the locked contract carries exactly these 6 fields.
 */
export interface InternalPersona {
  id: string;
  orgId: string;
  brandId: string;
  name: string;
  filters: Record<string, string[]>;
  status: PersonaStatus;
}

type PersonaRow = typeof brandPersonas.$inferSelect;

function formatPersona(row: PersonaRow): Persona {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    filters: row.filters,
    status: row.status as PersonaStatus,
    avatarUrl: row.avatarUrl ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Postgres unique-violation error code — raised by the
 * (brand_id, lower(name)) functional unique index when two writers race past
 * the pre-check. Surfaced as a 409 by the route.
 */
const UNIQUE_VIOLATION = '23505';

export class PersonaNameConflictError extends Error {
  constructor(name: string) {
    super(`A persona named "${name}" already exists for this brand`);
    this.name = 'PersonaNameConflictError';
  }
}

export class PersonaNotFoundError extends Error {
  constructor(personaId: string) {
    super(`Persona ${personaId} not found for this brand`);
    this.name = 'PersonaNotFoundError';
  }
}

/**
 * Raised by `listAllWithResolvedOrg` when one or more personas belong to a brand
 * with zero org_brands rows, so no owning org can be resolved. Fail loud (502) —
 * never fabricate an org and never silently omit (the backfill must see every
 * persona). Prod has zero orphans today; this guards against silent under-report.
 */
export class OrphanPersonaError extends Error {
  constructor(public readonly personaIds: string[]) {
    super(
      `Cannot resolve an owning org for ${personaIds.length} persona(s) whose brand has no org_brands claim: ${personaIds.join(', ')}`
    );
    this.name = 'OrphanPersonaError';
  }
}

/**
 * Append " (copy)", " (copy 2)", … to `base` until the result is free
 * (case-insensitive) among `taken`. Pure — unit-tested in isolation.
 */
export function uniquifyName(base: string, taken: string[]): string {
  const takenLower = new Set(taken.map((n) => n.toLowerCase()));
  if (!takenLower.has(base.toLowerCase())) return base;

  let candidate = `${base} (copy)`;
  let n = 2;
  while (takenLower.has(candidate.toLowerCase())) {
    candidate = `${base} (copy ${n})`;
    n += 1;
  }
  return candidate;
}

export class PersonaService {
  /** All personas for a brand, newest first, optionally filtered by status. */
  async listByBrandId(brandId: string, status?: PersonaStatus): Promise<Persona[]> {
    const where = status
      ? and(eq(brandPersonas.brandId, brandId), eq(brandPersonas.status, status))
      : eq(brandPersonas.brandId, brandId);

    const rows = await db
      .select()
      .from(brandPersonas)
      .where(where)
      .orderBy(desc(brandPersonas.createdAt));

    return rows.map(formatPersona);
  }

  /**
   * EVERY persona across ALL brands/orgs, each stamped with its owning org.
   * Org resolution: the EARLIEST org_brands claim for the persona's brand
   * (min claimed_at, tie-broken by org_id asc for determinism). A persona whose
   * brand has no org_brands row cannot be resolved → throws OrphanPersonaError
   * (fail loud). Read-only.
   */
  async listAllWithResolvedOrg(): Promise<InternalPersona[]> {
    // Earliest claim per brand: DISTINCT ON keeps the first row per brand_id
    // under the (brand_id, claimed_at asc, org_id asc) ordering.
    const earliest = db
      .selectDistinctOn([orgBrands.brandId], {
        brandId: orgBrands.brandId,
        orgId: orgBrands.orgId,
      })
      .from(orgBrands)
      .orderBy(orgBrands.brandId, asc(orgBrands.claimedAt), asc(orgBrands.orgId))
      .as('earliest');

    const rows = await db
      .select({
        id: brandPersonas.id,
        brandId: brandPersonas.brandId,
        name: brandPersonas.name,
        filters: brandPersonas.filters,
        status: brandPersonas.status,
        orgId: earliest.orgId,
      })
      .from(brandPersonas)
      .leftJoin(earliest, eq(earliest.brandId, brandPersonas.brandId));

    const orphans = rows.filter((r) => r.orgId == null).map((r) => r.id);
    if (orphans.length > 0) throw new OrphanPersonaError(orphans);

    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId as string,
      brandId: r.brandId,
      name: r.name,
      filters: r.filters,
      status: r.status as PersonaStatus,
    }));
  }

  /** Every persona name for a brand (all statuses) — used for uniqueness checks. */
  private async namesForBrand(brandId: string): Promise<string[]> {
    const rows = await db
      .select({ name: brandPersonas.name })
      .from(brandPersonas)
      .where(eq(brandPersonas.brandId, brandId));
    return rows.map((r) => r.name);
  }

  /**
   * Create an immutable persona. Throws PersonaNameConflictError when the name
   * collides case-insensitively with ANY existing persona for the brand
   * (active, paused, or archived). The DB unique index is the race backstop.
   */
  async create(
    brandId: string,
    name: string,
    filters: Record<string, string[]>
  ): Promise<Persona> {
    const taken = await this.namesForBrand(brandId);
    if (taken.some((n) => n.toLowerCase() === name.toLowerCase())) {
      throw new PersonaNameConflictError(name);
    }

    try {
      const [row] = await db
        .insert(brandPersonas)
        .values({ brandId, name, filters, status: 'active' })
        .returning();
      return formatPersona(row);
    } catch (err: any) {
      if (err?.code === UNIQUE_VIOLATION) throw new PersonaNameConflictError(name);
      throw err;
    }
  }

  /**
   * Duplicate an existing persona's filters under a new name. When `name` is
   * omitted or already taken, it is auto-uniquified from the source name.
   * Returns 404-class error if the source persona doesn't belong to the brand.
   */
  async duplicate(
    brandId: string,
    personaId: string,
    requestedName?: string
  ): Promise<Persona> {
    const [source] = await db
      .select()
      .from(brandPersonas)
      .where(and(eq(brandPersonas.id, personaId), eq(brandPersonas.brandId, brandId)))
      .limit(1);

    if (!source) throw new PersonaNotFoundError(personaId);

    const taken = await this.namesForBrand(brandId);
    const base = requestedName && requestedName.trim().length > 0 ? requestedName : source.name;
    const name = uniquifyName(base, taken);

    try {
      const [row] = await db
        .insert(brandPersonas)
        .values({ brandId, name, filters: source.filters, status: 'active', avatarUrl: null, avatarVersion: 0 })
        .returning();
      return formatPersona(row);
    } catch (err: any) {
      if (err?.code === UNIQUE_VIOLATION) throw new PersonaNameConflictError(name);
      throw err;
    }
  }

  /**
   * Flip a persona's status (the ONLY mutable field). Archived personas are
   * never deleted — they keep existing under 'archived'.
   */
  async setStatus(
    brandId: string,
    personaId: string,
    status: PersonaStatus
  ): Promise<Persona> {
    const [row] = await db
      .update(brandPersonas)
      .set({ status })
      .where(and(eq(brandPersonas.id, personaId), eq(brandPersonas.brandId, brandId)))
      .returning();

    if (!row) throw new PersonaNotFoundError(personaId);
    return formatPersona(row);
  }

  async getByBrandIdAndPersonaId(brandId: string, personaId: string): Promise<Persona> {
    const [row] = await db
      .select()
      .from(brandPersonas)
      .where(and(eq(brandPersonas.id, personaId), eq(brandPersonas.brandId, brandId)))
      .limit(1);

    if (!row) throw new PersonaNotFoundError(personaId);
    return formatPersona(row);
  }

  async setAvatarUrl(
    brandId: string,
    personaId: string,
    avatarUrl: string
  ): Promise<Persona> {
    const [row] = await db
      .update(brandPersonas)
      .set({
        avatarUrl,
        avatarVersion: sql`${brandPersonas.avatarVersion} + 1`,
        avatarGeneratedAt: sql`NOW()`,
      })
      .where(and(eq(brandPersonas.id, personaId), eq(brandPersonas.brandId, brandId)))
      .returning();

    if (!row) throw new PersonaNotFoundError(personaId);
    return formatPersona(row);
  }
}

export const personaService = new PersonaService();
