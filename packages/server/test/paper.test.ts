import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { paperHtml } from '../src/paper.ts';

const bloque = (stableId: string, parent: string | null, position: number, content: string) => ({
  stableId,
  parent,
  position,
  content,
});

/*
 * El papel es el documento sin el taller alrededor.
 *
 * Lo que estas pruebas fijan es qué se queda fuera —las propiedades, las
 * referencias, los fondos, la sangría del esquema— porque es lo que distingue un
 * PDF que se guarda de una foto de la pantalla.
 */
describe('paperHtml', () => {
  it('lleva el título de la página y el texto de sus bloques', () => {
    const html = paperHtml({
      title: 'Vera — Manual',
      blocks: [bloque('block:1', null, 0, 'Antes de nada'), bloque('block:2', null, 1, 'Se escribe en bloques.')],
    });
    assert.match(html, /<h1 class="paper-title">Vera — Manual<\/h1>/);
    assert.match(html, /Se escribe en bloques\./);
  });

  it('los bloques van en orden de lectura, cada hijo tras su padre', () => {
    const html = paperHtml({
      title: 'Orden',
      blocks: [
        bloque('block:hijo', 'block:padre', 0, 'el hijo'),
        bloque('block:segundo', null, 1, 'el segundo'),
        bloque('block:padre', null, 0, 'el padre'),
      ],
    });
    const dónde = (text: string): number => html.indexOf(text);
    assert.ok(dónde('el padre') < dónde('el hijo'));
    assert.ok(dónde('el hijo') < dónde('el segundo'));
  });

  it('un bloque cuyo padre no está en la página no se pierde', () => {
    // No debería pasar, y por eso mismo hay que decidir qué hacer si pasa: un
    // documento al que le falta un párrafo sin avisar es peor que uno con el
    // párrafo fuera de sitio.
    const html = paperHtml({
      title: 'Huérfano',
      blocks: [bloque('block:1', null, 0, 'con padre'), bloque('block:2', 'block:fuera', 0, 'sin padre')],
    });
    assert.match(html, /sin padre/);
  });

  it('sin sangría: el papel va en texto seguido', () => {
    const html = paperHtml({
      title: 'Seguido',
      blocks: [bloque('block:1', null, 0, 'raíz'), bloque('block:2', 'block:1', 0, 'hondo')],
    });
    assert.ok(!html.includes('margin-left'));
  });

  it('con sangría, si se pide para comparar', () => {
    const html = paperHtml({
      title: 'Sangrado',
      blocks: [bloque('block:1', null, 0, 'raíz'), bloque('block:2', 'block:1', 0, 'hondo')],
      indent: true,
    });
    assert.match(html, /margin-left:1\.2rem/);
  });

  it('un bloque vacío no ocupa sitio en el papel', () => {
    const html = paperHtml({
      title: 'Vacíos',
      blocks: [bloque('block:1', null, 0, 'algo'), bloque('block:2', null, 1, '   ')],
    });
    assert.equal(html.match(/<div class="b"/g)?.length, 1);
  });

  it('carta, y sin fondo', () => {
    const html = paperHtml({ title: 'Papel', blocks: [] });
    assert.match(html, /size: letter/);
    assert.match(html, /background: none/);
  });

  it('lo incrustado no corre en el papel: queda dónde estaba', () => {
    const html = paperHtml({
      title: 'Incrustado',
      blocks: [bloque('block:1', null, 0, '<iframe src="https://ejemplo.cl/x?y=1#z"></iframe>')],
      embedHosts: ['ejemplo.cl'],
    });
    // La dirección va dicha corta —origen y ruta— porque una herramienta que
    // recibe su documento en el fragmento traería media hoja de base64.
    assert.match(html, /data-source="https:\/\/ejemplo\.cl\/x"/);
    assert.match(html, /incrustado desde ' attr\(data-source\)/);
  });

  it('las imágenes del corpus resuelven a su objeto', () => {
    const html = paperHtml({
      title: 'Con foto',
      blocks: [bloque('block:1', null, 0, '![una foto](../assets/foto.png)')],
      assets: [{ path: '../assets/foto.png', url: '/media/abc123', mediaType: 'image/png' }],
    });
    assert.match(html, /src="\/media\/abc123"/);
  });

  it('el título se escapa: una página puede llamarse como quiera', () => {
    const html = paperHtml({ title: '<script>alert(1)</script>', blocks: [] });
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });
});

/*
 * Las citas de bloque.
 *
 * @invariant AQuotedBlockTravelsAsItsWords. En pantalla una cita es un enlace que
 * se pulsa para ir a leer la frase; en papel no hay adónde ir, así que o viaja la
 * frase o no viaja nada.
 */
describe('un bloque citado', () => {
  const citado = {
    page: 'Amereida',
    excerpt: 'no se llega a América, se llega a un mar que no tiene nombre todavía',
  };

  it('va con su texto entero y no con su identificador', () => {
    const html = paperHtml({
      title: 'Con cita',
      blocks: [bloque('block:1', null, 0, 'Como se dijo: ((block:lejano))')],
      resolveBlock: (id) => (id === 'block:lejano' ? citado : null),
    });
    assert.match(html, /no tiene nombre todav[íi]a/);
    assert.ok(!html.includes('block:lejano'), 'el identificador no se imprime');
  });

  it('y no como enlace: en un PDF no hay adónde ir', () => {
    const html = paperHtml({
      title: 'Con cita',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => citado,
    });
    assert.ok(!/<a class="block-ref"/.test(html), 'sigue siendo un enlace');
    assert.match(html, /<span class="quoted">/);
  });

  it('dice de qué página salió: un texto ajeno sin procedencia se lee como propio', () => {
    const html = paperHtml({
      title: 'Con cita',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => citado,
    });
    assert.match(html, /<span class="quoted-from">Amereida<\/span>/);
  });

  it('va entera y no recortada, aunque sea larga', () => {
    // En pantalla el extracto basta porque es la etiqueta de algo que se abre; en
    // papel es todo lo que el lector va a tener nunca de esa frase.
    const larga = 'palabra '.repeat(80).trim();
    const html = paperHtml({
      title: 'Con cita larga',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => ({ page: 'Otra', excerpt: larga }),
    });
    assert.ok(html.includes(larga), 'la cita llegó recortada');
  });

  it('una cita cuyo bloque ya no existe se dice, no se inventa', () => {
    const html = paperHtml({
      title: 'Con cita rota',
      blocks: [bloque('block:1', null, 0, '((block:fantasma))')],
      resolveBlock: () => null,
    });
    assert.match(html, /ya no est[áa] en el corpus/);
    assert.ok(!html.includes('block:fantasma'), 'el identificador no se imprime');
  });

  it('sin resolvedor no se finge: no hay cita que imprimir', () => {
    // Es el estado anterior a esto, y se deja fijado para que no vuelva por
    // descuido: sin quien resuelva, lo que salía era el identificador.
    const html = paperHtml({
      title: 'Sin resolvedor',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
    });
    assert.match(html, /ya no est[áa] en el corpus/);
  });

  it('el texto citado se escapa: un bloque puede decir lo que quiera', () => {
    const html = paperHtml({
      title: 'Con cita hostil',
      blocks: [bloque('block:1', null, 0, '((block:lejano))')],
      resolveBlock: () => ({ page: 'Otra', excerpt: '<script>alert(1)</script>' }),
    });
    assert.ok(!html.includes('<script>alert'));
    assert.match(html, /&lt;script&gt;/);
  });
});
