// El enrutado. Entra una dirección, sale qué hay que abrir; y al revés.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EMPTY, parseRoute, routeTo, sameRoute } from '../src/router.ts';

const at = (href: string): URL => new URL(href, 'https://vera.example');

describe('parseRoute', () => {
  it('la raíz no nombra ninguna página', () => {
    assert.deepEqual(parseRoute(at('/')), EMPTY);
  });

  it('lee el título de la página', () => {
    assert.deepEqual(parseRoute(at('/p/Lectogram')), {
      page: 'Lectogram',
      focus: null,
      block: null,
    });
  });

  it('descodifica un título con espacios y acentos', () => {
    const route = parseRoute(at('/p/MediaFranca%20-%20Visi%C3%B3n%20y%20Misi%C3%B3n'));
    assert.equal(route.page, 'MediaFranca - Visión y Misión');
  });

  it('acepta también la identidad estable', () => {
    // Un enlace escrito antes de un renombrado tiene que seguir resolviendo.
    assert.equal(parseRoute(at('/p/page:31015')).page, 'page:31015');
  });

  it('lee el enfoque de la vista', () => {
    assert.equal(parseRoute(at('/p/Lectogram?focus=block:31024')).focus, 'block:31024');
  });

  it('lee el bloque al que saltar', () => {
    assert.equal(parseRoute(at('/p/Lectogram#block:31066')).block, 'block:31066');
  });

  it('lee las tres cosas a la vez', () => {
    assert.deepEqual(parseRoute(at('/p/Lectogram?focus=block:1#block:2')), {
      page: 'Lectogram',
      focus: 'block:1',
      block: 'block:2',
    });
  });

  it('una ruta que no es de página no nombra ninguna', () => {
    assert.deepEqual(parseRoute(at('/otra/cosa')), EMPTY);
  });

  it('una codificación rota no tumba el arranque', () => {
    // `%` suelto no es una secuencia válida y decodeURIComponent lanza.
    assert.doesNotThrow(() => parseRoute(at('/p/roto%')));
    assert.equal(parseRoute(at('/p/roto%')).page, 'roto%');
  });
});

describe('routeTo', () => {
  const page = { id: 'page:31015', title: 'Lectogram' };

  it('nombra la página por su título, que es lo que se lee', () => {
    assert.equal(routeTo(page), '/p/Lectogram');
  });

  it('usa la dirección canónica limpia en el sitio público', () => {
    assert.equal(routeTo(page, { publicPath: 'lectogram' }), '/lectogram/');
    assert.equal(
      routeTo(page, { publicPath: 'ensayos/lectogram', block: 'block:2' }),
      '/ensayos/lectogram/#block%3A2',
    );
  });

  it('codifica lo que rompería la ruta', () => {
    const raro = { id: 'page:1', title: 'Uno / Dos ¿tres?' };
    const url = routeTo(raro);
    assert.ok(!url.slice('/p/'.length).includes('/'), `una barra inventaría un nivel: ${url}`);
    assert.equal(parseRoute(at(url)).page, 'Uno / Dos ¿tres?');
  });

  it('cae a la identidad cuando no hay título utilizable', () => {
    assert.equal(routeTo({ id: 'page:7', title: '   ' }), '/p/page%3A7');
  });

  it('lleva el enfoque y el bloque cuando los hay', () => {
    assert.equal(
      routeTo(page, { focus: 'block:1', block: 'block:2' }),
      '/p/Lectogram?focus=block%3A1#block%3A2',
    );
  });

  it('no escribe partes vacías', () => {
    assert.equal(routeTo(page, { focus: null, block: '' }), '/p/Lectogram');
  });

  it('lo que escribe, lo vuelve a leer igual', () => {
    for (const titulo of ['Lectogram', 'Uno / Dos', 'con§tel', '@Buchanan2001', 'a b  c']) {
      const url = routeTo({ id: 'page:1', title: titulo }, { focus: 'block:9' });
      const route = parseRoute(at(url));
      assert.equal(route.page, titulo, url);
      assert.equal(route.focus, 'block:9');
    }
  });
});

describe('sameRoute', () => {
  it('reconoce la misma dirección', () => {
    assert.equal(sameRoute(parseRoute(at('/p/A')), parseRoute(at('/p/A'))), true);
  });

  it('distingue por enfoque', () => {
    assert.equal(sameRoute(parseRoute(at('/p/A')), parseRoute(at('/p/A?focus=b'))), false);
  });
});
