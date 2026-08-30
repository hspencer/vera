import { startRegistration } from '@simplewebauthn/browser';
import { DEFAULT_TOKENS, session } from './tokens.ts';

/**
 * El color y la letra de esta pantalla, antes de que arranque el resto de la
 * aplicación.
 *
 * @guarantee EditableDesignSystem, tokens.ts: el diseño de Vera es uno solo y
 * se ajusta desde dentro de la aplicación, no dos veces. Esta pantalla llega
 * antes de que `main.ts` cargue —quien la abre puede no tener nada en
 * caché— así que no puede depender del arranque para verse como Vera; pero
 * "no depender del arranque" no es lo mismo que "inventar su propia paleta".
 * Usa los mismos `DEFAULT_TOKENS` y respeta la preferencia de esquema ya
 * guardada, igual que `applyTokens` lo haría una vez arrancada.
 */
interface CriticalPalette {
  bg: string;
  bgRaised: string;
  text: string;
  textDim: string;
  rule: string;
  accent: string;
  warm: string;
  fontUi: string;
}

function criticalPalette(): CriticalPalette {
  const scheme = session.scheme();
  const value = (name: string): string =>
    DEFAULT_TOKENS.find((token) => token.name === name)?.[scheme] ?? '';
  return {
    bg: value('--bg'),
    bgRaised: value('--bg-raised'),
    text: value('--text'),
    textDim: value('--text-dim'),
    rule: value('--rule'),
    accent: value('--accent'),
    warm: value('--warm'),
    fontUi: value('--font-ui'),
  };
}

const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
  const response = await fetch(path, { method, credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};

const shell = (title: string): HTMLElement => {
  // La invitación es la puerta de entrada y tiene que seguir siendo legible aun
  // si el armazón quedó en la caché con una hoja compilada que el servidor ya no
  // conserva. El estilo crítico viaja con el mismo módulo que dibuja la página;
  // la hoja general puede enriquecerlo, pero no es una dependencia para entrar.
  if (document.querySelector('#invitation-critical-style') === null) {
    const p = criticalPalette();
    const style = document.createElement('style');
    style.id = 'invitation-critical-style';
    style.textContent = `
      #vera-root[data-layout='invitation']{display:grid;grid-template-columns:1fr;grid-template-areas:none;height:auto;min-height:100dvh;place-items:center;background:${p.bg};color:${p.text};font-family:${p.fontUi}}
      .invitation-access{box-sizing:border-box;width:min(100% - 2rem,36rem);margin:2rem auto;padding:clamp(1.5rem,5vw,3rem);border:1px solid ${p.rule};border-radius:1.25rem;background:${p.bgRaised}}
      .invitation-mark{margin:0;color:${p.textDim};font-size:.78rem;font-weight:650;letter-spacing:.09em;text-transform:uppercase}
      .invitation-access h1{margin:.45rem 0 1rem;color:${p.text};font-family:${p.fontUi};font-size:clamp(1.6rem,6vw,2.4rem);font-weight:600;line-height:1.15}
      .invitation-detail{margin:0 0 1.75rem;color:${p.textDim};line-height:1.55}
      .invitation-field{display:grid;gap:.45rem;margin:0 0 1rem;color:${p.text};font-size:.88rem;font-weight:650}
      .invitation-field input{box-sizing:border-box;width:100%;padding:.8rem .9rem;border:1px solid ${p.rule};border-radius:.55rem;background:${p.bg};color:${p.text};font:inherit;font-weight:400}
      .invitation-field input:focus{outline:3px solid color-mix(in srgb, ${p.accent} 30%, transparent);border-color:${p.accent}}
      .invitation-access button{width:100%;padding:.85rem 1rem;border:0;border-radius:.55rem;background:${p.accent};color:${p.bg};font:inherit;font-weight:650;cursor:pointer}
      .invitation-access button:disabled{cursor:wait;opacity:.58}
      .shared-notice{margin:1rem 0 0;color:${p.textDim};line-height:1.45}
      .shared-notice[data-bad='true']{color:${p.warm}}
    `;
    document.head.append(style);
  }
  document.querySelector('#sin-arranque')?.remove();
  const root = document.querySelector<HTMLElement>('#vera-root')!;
  root.dataset['layout'] = 'invitation';
  root.innerHTML = '';
  const main = document.createElement('main');
  main.className = 'invitation-access';
  const mark = document.createElement('p'); mark.className = 'invitation-mark'; mark.textContent = 'Vera · invitación';
  const heading = document.createElement('h1'); heading.textContent = title;
  main.append(mark, heading); root.append(main);
  return main;
};

const notice = (main: HTMLElement, said: string, bad = false): void => {
  let node = main.querySelector<HTMLElement>('.shared-notice');
  if (node === null) { node = document.createElement('p'); node.className = 'shared-notice'; main.append(node); }
  node.dataset['bad'] = String(bad); node.textContent = said;
};

async function invitation(id: string, secret: string): Promise<void> {
  const main = shell('Invitación');
  try {
    const preview = await json(`/invitations/${encodeURIComponent(id)}?secret=${encodeURIComponent(secret)}`);
    main.querySelector('h1')!.textContent = preview.space;
    const detail = document.createElement('p'); detail.className = 'invitation-detail';
    detail.textContent = `Acceso ${preview.permissions.join(', ')}. Esta invitación vence ${new Date(preview.expiresAt).toLocaleString()}.`;
    const field = document.createElement('label'); field.className = 'invitation-field'; field.textContent = 'Tu nombre';
    const name = document.createElement('input'); name.placeholder = 'Nombre y apellido'; name.autocomplete = 'name'; name.required = true;
    field.append(name);
    const accept = document.createElement('button'); accept.textContent = 'aceptar y crear una passkey';
    let redeemed: any | null = null;
    accept.onclick = () => void (async () => {
      if (name.value.trim() === '') { name.focus(); notice(main, 'Escribe tu nombre para continuar.', true); return; }
      accept.disabled = true; notice(main, 'Creando tu identidad y preparando la passkey…');
      try {
        // El canje es de un solo uso, pero la ceremonia del navegador puede ser
        // cancelada o fallar. Conservar sus credenciales permite reintentar la
        // passkey sin intentar gastar por segunda vez la invitación.
        redeemed ??= await json(`/invitations/${encodeURIComponent(id)}/redeem`, 'POST',
          { secret, name: name.value.trim() });
        name.disabled = true;
        const options = await json('/human-auth/registration/options', 'POST',
          { enrollment: redeemed.enrollment, secret: redeemed.enrollmentSecret });
        const response = await startRegistration({ optionsJSON: options });
        await json('/human-auth/registration/verify', 'POST',
          { enrollment: redeemed.enrollment, secret: redeemed.enrollmentSecret, response });
        localStorage.setItem(`vera-human:${redeemed.spaceSlug}`, redeemed.participant);
        location.assign(`/s/${encodeURIComponent(redeemed.spaceSlug)}`);
      } catch (error) {
        notice(main, error instanceof Error ? error.message : 'No se pudo aceptar la invitación.', true);
        if (redeemed !== null) accept.textContent = 'volver a intentar la passkey';
        accept.disabled = false;
      }
    })();
    main.append(detail, field, accept);
  } catch (error) { notice(main, error instanceof Error ? error.message : 'La invitación no está disponible.', true); }
}

/**
 * rule OwnerAuthorizesOwnAuthenticatorFromMachine (shared-space-access.allium).
 *
 * A diferencia de `invitation()`, no hay nombre que pedir ni invitación que
 * canjear: la matrícula ya existe, la creó `npm run owner:enroll-passkey`
 * desde la máquina, y esta pantalla sólo lleva a cabo la ceremonia WebAuthn
 * sobre una identidad que ya es dueña del grafo.
 */
async function ownerEnrollment(enrollment: string, secret: string): Promise<void> {
  const main = shell('Tu passkey');
  const detail = document.createElement('p'); detail.className = 'invitation-detail';
  detail.textContent = 'Esta matrícula la autorizaste desde la máquina que sostiene tu corpus. Registra una passkey para entrar como quien eres.';
  const register = document.createElement('button'); register.textContent = 'crear mi passkey';
  register.onclick = () => void (async () => {
    register.disabled = true; notice(main, 'Preparando la passkey…');
    try {
      const options = await json('/human-auth/registration/options', 'POST', { enrollment, secret });
      const response = await startRegistration({ optionsJSON: options });
      await json('/human-auth/registration/verify', 'POST', { enrollment, secret, response });
      location.assign('/');
    } catch (error) {
      notice(main, error instanceof Error ? error.message : 'No se pudo registrar la passkey.', true);
      register.textContent = 'volver a intentar';
      register.disabled = false;
    }
  })();
  main.append(detail, register);
}

export function handlesSharedAccess(): boolean {
  const invite = /^\/invite\/([^/]+)$/.exec(location.pathname);
  if (invite !== null) {
    void invitation(decodeURIComponent(invite[1] ?? ''), new URL(location.href).searchParams.get('secret') ?? '');
    return true;
  }
  const enroll = /^\/enroll-owner\/([^/]+)$/.exec(location.pathname);
  if (enroll !== null) {
    void ownerEnrollment(decodeURIComponent(enroll[1] ?? ''), new URL(location.href).searchParams.get('secret') ?? '');
    return true;
  }
  // Un espacio no es una aplicación aparte. No existe un lector alternativo:
  // toda ruta `/s/<slug>` arranca Vera y el servidor sólo cerca su subgrafo y
  // su autoridad. Este módulo interviene exclusivamente en `/invite/<id>` y
  // `/enroll-owner/<id>`.
  return false;
}
