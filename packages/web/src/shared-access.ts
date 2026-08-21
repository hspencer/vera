import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

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
  root.dataset['layout'] = 'shared';
  root.innerHTML = '';
  const main = document.createElement('main');
  main.className = 'shared-access';
  const mark = document.createElement('p'); mark.className = 'shared-mark'; mark.textContent = 'Vera · espacio compartido';
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

const renderPage = (main: HTMLElement, view: any): void => {
  main.innerHTML = '';
  const back = document.createElement('button'); back.textContent = `← ${view.space.name}`;
  back.onclick = () => location.assign(`/s/${encodeURIComponent(view.space.slug)}`);
  const heading = document.createElement('h1'); heading.textContent = view.page.title;
  main.append(back, heading);
  for (const block of view.page.blocks) {
    const paragraph = document.createElement('p'); paragraph.textContent = block.content;
    paragraph.style.marginLeft = block.parent === null ? '0' : '1.5rem'; main.append(paragraph);
  }
};

async function space(slug: string): Promise<void> {
  const main = shell('Espacio compartido');
  const open = async (): Promise<void> => {
    const view = await json(`/s/${encodeURIComponent(slug)}/api/pages`);
    main.querySelector('h1')!.textContent = view.space.name;
    const list = document.createElement('ul'); list.className = 'shared-pages';
    for (const page of view.pages) {
      const item = document.createElement('li'); const link = document.createElement('button'); link.textContent = page.title;
      link.onclick = () => void json(`/s/${encodeURIComponent(slug)}/api/pages/${encodeURIComponent(page.id)}`)
        .then((detail) => renderPage(main, detail)).catch((error) => notice(main, error.message, true));
      item.append(link); list.append(item);
    }
    main.append(list);
  };
  try { await open(); return; } catch { /* una sesión ausente se resuelve con la passkey */ }
  const participant = localStorage.getItem(`vera-human:${slug}`);
  if (participant === null) { notice(main, 'Abre primero el enlace de invitación en este aparato.', true); return; }
  const login = document.createElement('button'); login.textContent = 'entrar con passkey';
  login.onclick = () => void (async () => {
    login.disabled = true;
    try {
      const options = await json('/human-auth/authentication/options', 'POST', { participant });
      const response = await startAuthentication({ optionsJSON: options });
      await json('/human-auth/authentication/verify', 'POST', { participant, response });
      main.innerHTML = ''; const heading = document.createElement('h1'); heading.textContent = 'Espacio compartido'; main.append(heading);
      await open();
    } catch (error) { notice(main, error instanceof Error ? error.message : 'No se pudo entrar.', true); login.disabled = false; }
  })();
  main.append(login);
}

export function handlesSharedAccess(): boolean {
  const invite = /^\/invite\/([^/]+)$/.exec(location.pathname);
  if (invite !== null) {
    void invitation(decodeURIComponent(invite[1] ?? ''), new URL(location.href).searchParams.get('secret') ?? '');
    return true;
  }
  const shared = /^\/s\/([^/]+)\/?$/.exec(location.pathname);
  if (shared !== null) { void space(decodeURIComponent(shared[1] ?? '')); return true; }
  return false;
}
