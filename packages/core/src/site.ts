// La dirección pública de una publicación.
//
// Vive en el dominio y no en el generador del sitio porque la escriben dos
// manos: quien publica, que elige la dirección, y el build, que la usa para
// nombrar el archivo. Dos implementaciones de «cómo se escribe una ruta»
// discreparían el día que un título llevara un acento, y entonces la URL
// canónica que la publicación prometió no sería la que el sitio sirve.

/**
 * La forma en que una ruta queda escrita: sin barras en los extremos, sin
 * segmentos vacíos y sin nada que pueda salirse del sitio.
 *
 * `..` no se limpia: se rechaza. Una ruta que sube de directorio no es una
 * dirección mal escrita, es un intento de escribir fuera del sitio, y
 * corregirla en silencio enseñaría a confiar en que el build la arregle.
 */
export function normalisePublicPath(path: string): string {
  const segments = path
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`a public path does not traverse directories: ${path}`);
    }
    if (segment.includes('\\') || segment.includes('\0')) {
      throw new Error(`a public path does not contain ${JSON.stringify(segment)}`);
    }
  }
  return segments.join('/');
}

/**
 * La dirección que se le propone a quien publica una página, derivada de su
 * título. Es una sugerencia y no una regla: la dirección la fija la publicación,
 * porque una URL que cambia cuando se corrige un título no es estable.
 *
 * @invariant StablePublicAddress (core.allium)
 */
export function suggestedPathFor(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? 'pagina' : slug;
}

/** La URL canónica de una publicación: un dominio, una ruta, una sola forma. */
export function canonicalUrl(domain: string, path: string): string {
  const base = normaliseCanonicalDomain(domain);
  const route = normalisePublicPath(path);
  return route === '' ? `${base}/` : `${base}/${route}/`;
}

/** La raíz pública del sitio, guardada en una sola forma. */
export function normaliseCanonicalDomain(domain: string): string {
  let parsed: URL;
  try {
    parsed = new URL(domain.trim());
  } catch {
    throw new Error('the canonical domain must be an absolute HTTP(S) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('the canonical domain must use HTTP or HTTPS');
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('the canonical domain does not contain credentials, a query, or a fragment');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('the canonical domain does not contain a path');
  }
  return parsed.origin;
}
