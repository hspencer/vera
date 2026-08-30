// El dueño se autoriza a sí mismo su primera passkey desde la máquina.
//
// specs/shared-space-access.allium:
//   rule OwnerAuthorizesOwnAuthenticatorFromMachine
//   rule FreshInstanceBeginsOwnerAuthenticationBootstrap
//   rule FirstOwnerPasskeyCompletesBootstrap
//
// Antes de esto, la única vía de alta humana completa (ceremonia WebAuthn de
// punta a punta) era `redeemInvitation`, pensada para invitados. El dueño de
// una instancia soberana no puede depender de invitarse a sí mismo: necesita
// una puerta que nazca de la máquina, igual que `issue-owner.ts` la abre para
// la credencial de agente.
//
// Esta instancia no es «fresca» en el sentido literal de la spec —el corpus
// existe desde antes de que este mecanismo se escribiera—, así que el primer
// llamado a beginOwnerBootstrap() cumple el papel de
// FreshInstanceBeginsOwnerAuthenticationBootstrap con `INSERT OR IGNORE`: crea
// el registro si no existe, y no lo toca si ya lo hizo una vez.

import { randomBytes } from 'node:crypto';
import type { Store } from '@vera/store';
import { digestOf } from './credentials.ts';

const secret = (prefix: string): string => `${prefix}${randomBytes(32).toString('base64url')}`;
const id = (prefix: string): string => `${prefix}:${randomBytes(8).toString('hex')}`;

const ENROLLMENT_LIFETIME_MS = 15 * 60 * 1000;

export type BootstrapStatus = 'awaiting_first_passkey' | 'ready';

/**
 * Autoriza al dueño a matricular una passkey nueva, desde la máquina.
 *
 * @invariant TheMachineIsTheLastResort (identity-access.allium): quien tiene
 * la máquina puede emitirse acceso sin tener ninguno. Esta función no se monta
 * en ninguna ruta HTTP — se invoca sólo desde `enroll-owner-passkey.ts`, un
 * script de línea de comandos que abre la base directamente.
 *
 * Cada llamada crea una matrícula nueva, independiente de las anteriores: es
 * tanto el alta inicial (rule FreshInstanceBeginsOwnerAuthenticationBootstrap)
 * como la recuperación si el dueño pierde todas sus passkeys (rule
 * OwnerAuthorizesOwnAuthenticatorFromMachine). Las matrículas vencidas o ya
 * completadas simplemente dejan de servir para nada; no hace falta revocarlas
 * a mano.
 */
export function beginOwnerBootstrap(
  store: Store,
  owner: string,
): { enrollment: string; enrollmentSecret: string; expiresAt: number } {
  const now = Date.now();
  store.db
    .prepare(`INSERT OR IGNORE INTO human_access_bootstrap (graph_id, status)
      VALUES (?, 'awaiting_first_passkey')`)
    .run(store.graphId);

  const enrollment = id('enrollment');
  const enrollmentSecret = secret('vera_enroll_');
  const expiresAt = now + ENROLLMENT_LIFETIME_MS;
  store.db
    .prepare(`INSERT INTO authenticator_enrollments
      (id, graph_id, participant_id, authorized_by, proof_digest, status, expires_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
    .run(enrollment, store.graphId, owner, owner, digestOf(enrollmentSecret), expiresAt);

  return { enrollment, enrollmentSecret, expiresAt };
}

/**
 * rule FirstOwnerPasskeyCompletesBootstrap.
 *
 * Se llama tras cualquier registro de passkey exitoso, para cualquier
 * participante — es barata y no hace nada si `participant` no es el dueño o
 * si el bootstrap ya estaba listo, así que no hace falta que quien la llama
 * decida de antemano si aplica.
 */
export function completeOwnerBootstrapIfDue(store: Store, owner: string, participant: string): void {
  if (participant !== owner) return;
  store.db
    .prepare(`UPDATE human_access_bootstrap SET status = 'ready'
      WHERE graph_id = ? AND status = 'awaiting_first_passkey'`)
    .run(store.graphId);
}

/**
 * `null` significa que esta instancia todavía no inició el bootstrap: nunca
 * se corrió `enroll-owner-passkey`. No es un tercer estado de la spec — es el
 * reflejo de que aquí el bootstrap no nace solo al crear la instancia, como
 * asumía `FreshInstanceBeginsOwnerAuthenticationBootstrap`.
 */
export function ownerBootstrapStatus(store: Store): BootstrapStatus | null {
  const row = store.db
    .prepare(`SELECT status FROM human_access_bootstrap WHERE graph_id = ?`)
    .get(store.graphId) as { status: BootstrapStatus } | undefined;
  return row?.status ?? null;
}
