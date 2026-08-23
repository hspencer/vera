import { startRegistration } from '@simplewebauthn/browser';

const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
  const response = await fetch(path, { method, credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
};

const shell = (title: string): HTMLElement => {
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
    const detail = document.createElement('p');
    detail.textContent = `Acceso ${preview.permissions.join(', ')}. Esta invitación vence ${new Date(preview.expiresAt).toLocaleString()}.`;
    const name = document.createElement('input'); name.placeholder = 'tu nombre'; name.autocomplete = 'name';
    const accept = document.createElement('button'); accept.textContent = 'aceptar y crear una passkey';
    accept.onclick = () => void (async () => {
      accept.disabled = true; notice(main, 'Creando tu identidad y preparando la passkey…');
      try {
        const redeemed = await json(`/invitations/${encodeURIComponent(id)}/redeem`, 'POST',
          { secret, name: name.value.trim() });
        const options = await json('/human-auth/registration/options', 'POST',
          { enrollment: redeemed.enrollment, secret: redeemed.enrollmentSecret });
        const response = await startRegistration({ optionsJSON: options });
        await json('/human-auth/registration/verify', 'POST',
          { enrollment: redeemed.enrollment, secret: redeemed.enrollmentSecret, response });
        localStorage.setItem(`vera-human:${redeemed.spaceSlug}`, redeemed.participant);
        location.assign(`/s/${encodeURIComponent(redeemed.spaceSlug)}`);
      } catch (error) {
        notice(main, error instanceof Error ? error.message : 'No se pudo aceptar la invitación.', true);
        accept.disabled = false;
      }
    })();
    main.append(detail, name, accept);
  } catch (error) { notice(main, error instanceof Error ? error.message : 'La invitación no está disponible.', true); }
}

export function handlesSharedAccess(): boolean {
  const invite = /^\/invite\/([^/]+)$/.exec(location.pathname);
  if (invite !== null) {
    void invitation(decodeURIComponent(invite[1] ?? ''), new URL(location.href).searchParams.get('secret') ?? '');
    return true;
  }
  // Un espacio no es una aplicación aparte. No existe un lector alternativo:
  // toda ruta `/s/<slug>` arranca Vera y el servidor sólo cerca su subgrafo y
  // su autoridad. Este módulo interviene exclusivamente en `/invite/<id>`.
  return false;
}
