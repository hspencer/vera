import { randomBytes } from 'node:crypto';
import type { Store } from '@vera/store';
import { digestOf } from './credentials.ts';

export type SharedPermission = 'read' | 'contribute' | 'edit';
export interface SharedSpace {
  id: string; name: string; slug: string; selectorKey: string; selectorValue: string;
  audience: 'anybody' | 'restricted'; status: 'active' | 'withdrawn'; createdAt: number;
}

const secret = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;
const id = (prefix: string): string => `${prefix}:${randomBytes(8).toString('hex')}`;

export function createSharedSpace(store: Store, owner: string, input: {
  name: string; slug: string; selectorKey: string; selectorValue: string;
  audience?: 'anybody' | 'restricted';
}): SharedSpace {
  const held: SharedSpace = { id: id('space'), name: input.name, slug: input.slug,
    selectorKey: input.selectorKey, selectorValue: input.selectorValue,
    audience: input.audience ?? 'restricted', status: 'active', createdAt: Date.now() };
  store.db.prepare(`INSERT INTO shared_spaces
    (id, graph_id, owner_id, name, slug, selector_key, selector_value, audience, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(held.id, store.graphId, owner, held.name, held.slug, held.selectorKey,
      held.selectorValue, held.audience, held.createdAt);
  return held;
}

export function sharedSpaceBySlug(store: Store, slug: string): SharedSpace | null {
  const row = store.db.prepare(`SELECT id, name, slug, selector_key, selector_value,
    audience, status, created_at FROM shared_spaces WHERE graph_id = ? AND slug = ?`)
    .get(store.graphId, slug) as any;
  return row === undefined ? null : { id: row.id, name: row.name, slug: row.slug,
    selectorKey: row.selector_key, selectorValue: row.selector_value,
    audience: row.audience, status: row.status, createdAt: row.created_at };
}

export function inviteToSpace(store: Store, owner: string, space: SharedSpace,
  permissions: SharedPermission[], intendedContact?: string): { id: string; secret: string; expiresAt: number } {
  const unique = [...new Set(permissions)];
  if (unique.length === 0 || !unique.includes('read')) throw new Error('la invitación debe incluir read');
  const proof = secret('vera_inv_');
  const invitation = id('invitation');
  const now = Date.now();
  const expiresAt = now + 15 * 60 * 1000;
  store.db.prepare(`INSERT INTO access_invitations
    (id, space_id, issued_by, permissions, proof_digest, intended_contact, status, issued_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(invitation, space.id, owner, unique.sort().join(','), digestOf(proof),
      intendedContact ?? null, now, expiresAt);
  return { id: invitation, secret: proof, expiresAt };
}

export function inspectInvitation(store: Store, invitation: string, proof: string): any | null {
  const row = store.db.prepare(`SELECT i.id, i.status, i.permissions, i.expires_at,
    s.name, s.slug FROM access_invitations i JOIN shared_spaces s ON s.id=i.space_id
    WHERE i.id=? AND i.proof_digest=?`).get(invitation, digestOf(proof)) as any;
  if (row === undefined) return null;
  const status = row.status === 'pending' && row.expires_at <= Date.now() ? 'expired' : row.status;
  return { id: row.id, space: row.name, slug: row.slug,
    permissions: String(row.permissions).split(','), status, expiresAt: row.expires_at };
}

export function redeemInvitation(store: Store, invitation: string, proof: string, name: string): any {
  const now = Date.now();
  const row = store.db.prepare(`SELECT i.*, s.graph_id, s.owner_id, s.name AS space_name, s.slug AS space_slug
    FROM access_invitations i JOIN shared_spaces s ON s.id=i.space_id
    WHERE i.id=? AND i.proof_digest=?`).get(invitation, digestOf(proof)) as any;
  if (row === undefined) throw new Error('la invitación no existe o el secreto no coincide');
  if (row.status !== 'pending' || row.expires_at <= now) throw new Error('la invitación venció o ya fue usada');
  const participant = id('participant:guest');
  const grant = id('grant');
  const enrollment = id('enrollment');
  const enrollmentSecret = secret('vera_enroll_');
  store.db.exec('BEGIN');
  try {
    store.db.prepare(`INSERT INTO participants (id,name,kind,status) VALUES (?,?,'human','active')`).run(participant, name);
    store.db.prepare(`INSERT INTO memberships (graph_id,participant_id,status) VALUES (?,?,'active')`).run(store.graphId, participant);
    store.db.prepare(`INSERT INTO access_grants
      (id,space_id,participant_id,permissions,status,granted_by,granted_at)
      VALUES (?,?,?,?,'active',?,?)`).run(grant, row.space_id, participant, row.permissions, row.owner_id, now);
    store.db.prepare(`INSERT INTO authenticator_enrollments
      (id,graph_id,participant_id,authorized_by,proof_digest,status,expires_at)
      VALUES (?,?,?,?,?,'pending',?)`).run(enrollment, store.graphId, participant,
        row.owner_id, digestOf(enrollmentSecret), now + 15 * 60 * 1000);
    store.db.prepare(`UPDATE access_invitations SET status='redeemed',redeemed_by=?,redeemed_at=? WHERE id=?`)
      .run(participant, now, invitation);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  return { participant, grant, enrollment, enrollmentSecret,
    space: row.space_name, spaceSlug: row.space_slug };
}
