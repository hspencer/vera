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
  // La invitación es la puerta de entrada y tiene que seguir siendo legible aun
  // si el armazón quedó en la caché con una hoja compilada que el servidor ya no
  // conserva. El estilo crítico viaja con el mismo módulo que dibuja la página;
  // la hoja general puede enriquecerlo, pero no es una dependencia para entrar.
  if (document.querySelector('#invitation-critical-style') === null) {
    const style = document.createElement('style');
    style.id = 'invitation-critical-style';
    style.textContent = `
      #vera-root[data-layout='invitation']{display:grid;min-height:100dvh;place-items:center;background:#f7f4ef;color:#241b1f;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .invitation-access{box-sizing:border-box;width:min(100% - 2rem,36rem);margin:2rem auto;padding:clamp(1.5rem,5vw,3rem);border:1px solid #d8cec8;border-radius:1.25rem;background:#fffdf9;box-shadow:0 1.25rem 4rem rgba(46,0,36,.10)}
      .invitation-mark{margin:0;color:#765d6d;font-size:.78rem;font-weight:650;letter-spacing:.09em;text-transform:uppercase}
      .invitation-access h1{margin:.45rem 0 1rem;color:#2e0024;font-family:ui-serif,Georgia,serif;font-size:clamp(2rem,8vw,3.25rem);font-weight:500;line-height:1.05}
      .invitation-detail{margin:0 0 1.75rem;color:#5f5358;line-height:1.55}
      .invitation-field{display:grid;gap:.45rem;margin:0 0 1rem;color:#4b3d43;font-size:.88rem;font-weight:650}
      .invitation-field input{box-sizing:border-box;width:100%;padding:.8rem .9rem;border:1px solid #bcaeb5;border-radius:.55rem;background:white;color:inherit;font:inherit;font-weight:400}
      .invitation-field input:focus{outline:3px solid rgba(112,29,84,.18);border-color:#701d54}
      .invitation-access button{width:100%;padding:.85rem 1rem;border:0;border-radius:.55rem;background:#2e0024;color:white;font:inherit;font-weight:650;cursor:pointer}
      .invitation-access button:disabled{cursor:wait;opacity:.58}
      .shared-notice{margin:1rem 0 0;color:#5f5358;line-height:1.45}
      .shared-notice[data-bad='true']{color:#9b2727}
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
