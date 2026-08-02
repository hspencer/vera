// Pruebas del renderizador Markdown. No tocan el DOM: entra texto, sale HTML.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inlineMarkdown, renderMarkdown } from '../src/markdown.ts';

describe('inlineMarkdown', () => {
  it('escapa el HTML antes de cualquier otra cosa', () => {
    assert.equal(
      inlineMarkdown('<script>alert(1)</script>'),
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('convierte un enlace wiki en algo navegable', () => {
    assert.equal(
      inlineMarkdown('ver [[Travesía]]'),
      'ver <a class="wiki" data-page="Travesía" href="#">Travesía</a>',
    );
  });

  it('marca las etiquetas', () => {
    assert.equal(inlineMarkdown('sobre #diseño'), 'sobre <span class="tag">#diseño</span>');
  });

  it('no confunde una almohadilla pegada a una palabra', () => {
    assert.equal(inlineMarkdown('C#3'), 'C#3');
  });

  it('respeta negrita, cursiva y código', () => {
    assert.equal(inlineMarkdown('**a** *b* `c`'), '<strong>a</strong> <em>b</em> <code>c</code>');
  });

  it('no toma la negrita por cursiva', () => {
    assert.equal(inlineMarkdown('**fuerte**'), '<strong>fuerte</strong>');
  });

  it('conserva los saltos de línea del bloque', () => {
    assert.equal(inlineMarkdown('una\notra'), 'una<br>otra');
  });

  it('deja pasar un enlace externo', () => {
    const rendered = inlineMarkdown('[sitio](https://herbertspencer.net)');
    assert.ok(rendered.includes('href="https://herbertspencer.net"'));
    assert.ok(rendered.includes('rel="noreferrer"'));
  });

  it('reconoce tachado y resaltado', () => {
    assert.equal(inlineMarkdown('~~ido~~ y ==esto=='), '<del>ido</del> y <mark>esto</mark>');
  });

  describe('imágenes', () => {
    it('emite una imagen remota', () => {
      assert.equal(
        inlineMarkdown('![gato](https://x.cl/g.png)'),
        '<img src="https://x.cl/g.png" alt="gato" loading="lazy">',
      );
    });

    it('acepta la ruta relativa que trae el corpus', () => {
      const html = inlineMarkdown('![](../assets/2024-06-06.jpeg)');
      assert.match(html, /<img src="\.\.\/assets\/2024-06-06\.jpeg" alt=""/);
    });

    it('no confunde una imagen con un enlace', () => {
      const html = inlineMarkdown('![alt](https://x.cl/a.png)');
      assert.ok(!html.includes('<a '), 'la imagen no debe producir un enlace');
    });
  });

  describe('seguridad', () => {
    it('no emite un href con javascript:', () => {
      const html = inlineMarkdown('[click](javascript:alert(1))');
      assert.ok(!html.includes('<a '), `no debe haber enlace: ${html}`);
      assert.ok(!html.toLowerCase().includes('javascript:alert(1)</a>'));
    });

    it('no emite un src con javascript:', () => {
      const html = inlineMarkdown('![x](javascript:alert(1))');
      assert.ok(!html.includes('<img'), `no debe haber imagen: ${html}`);
    });

    it('escapa las comillas de un atributo', () => {
      const html = inlineMarkdown('![" onerror="alert(1)](https://x.cl/a.png)');
      assert.ok(!html.includes('onerror="alert(1)"'), `atributo inyectado: ${html}`);
    });

    // Estos tres los encontró el corpus, no la imaginación. Una regla que corre
    // después de emitir un elemento reescribía lo que había dentro de sus
    // atributos, y ahí `class="tag"` cerraba el atributo y abría otros.
    describe('ninguna marca se cuela dentro de un atributo ya emitido', () => {
      it('una etiqueta dentro del texto alternativo no rompe el alt', () => {
        const html = inlineMarkdown('![a #tag](https://x.cl/i.png)');
        assert.equal(html, '<img src="https://x.cl/i.png" alt="a #tag" loading="lazy">');
      });

      it('una cursiva dentro del texto alternativo queda como texto', () => {
        const html = inlineMarkdown('![en *Begriffsschrift*](../assets/a.png)');
        assert.match(html, /alt="en \*Begriffsschrift\*"/);
        assert.ok(!html.includes('<em>'), `marcado dentro del alt: ${html}`);
      });

      it('una comilla en un enlace wiki no abre atributos nuevos', () => {
        const html = inlineMarkdown('[[titulo" onmouseover="alert(1)]]');
        // Lo que importa no es que el texto `onmouseover` no aparezca —aparece,
        // escapado, dentro del valor— sino que la etiqueta no gane atributos.
        const open = /^<a ([^>]*)>/.exec(html)?.[1] ?? '';
        const names = [...open.matchAll(/([a-z-]+)="/g)].map((match) => match[1]);
        assert.deepEqual(names, ['class', 'data-page', 'href'], `atributos: ${open}`);
        assert.match(html, /data-page="titulo&quot;/);
      });

      it('una almohadilla en una URL no se vuelve etiqueta', () => {
        assert.match(
          inlineMarkdown('[x](https://x.cl/a#seccion)'),
          /href="https:\/\/x\.cl\/a#seccion"/,
        );
      });
    });

    it('no escapa dos veces el ampersand de una URL', () => {
      const html = inlineMarkdown('[x](https://x.cl/a?u=1&v=2)');
      assert.match(html, /href="https:\/\/x\.cl\/a\?u=1&amp;v=2"/);
      assert.ok(!html.includes('&amp;amp;'), `doble escapado: ${html}`);
    });

    it('restituye una imagen anidada dentro de un enlace', () => {
      const html = inlineMarkdown('[![alt](https://x.cl/i.png)](https://x.cl)');
      assert.match(html, /^<a href="https:\/\/x\.cl"[^>]*><img src="https:\/\/x\.cl\/i\.png"/);
      assert.ok(!html.includes('\u0000'), `quedó una marca interna sin restituir: ${html}`);
    });

    it('descarta una marca interna que venga en la fuente', () => {
      assert.ok(!inlineMarkdown('a\u00000\u0000b').includes('\u0000'));
    });
  });

  describe('resolución de medios', () => {
    // El bloque conserva su `../assets/foo.png`; lo que cambia es a dónde
    // apunta la presentación. La fuente no se toca nunca.
    const resolver = {
      resolveAsset: (path: string) =>
        path === '../assets/foto.png'
          ? { url: '/media/' + 'a'.repeat(64), mediaType: 'image/png' }
          : path === '../assets/informe.pdf'
            ? { url: '/media/' + 'b'.repeat(64), mediaType: 'application/pdf' }
            : null,
    };

    it('una imagen del corpus apunta al objeto guardado', () => {
      const html = inlineMarkdown('![retrato](../assets/foto.png)', resolver);
      assert.match(html, new RegExp(`<img src="/media/${'a'.repeat(64)}" alt="retrato"`));
    });

    it('lo que no es imagen se ofrece como archivo, no se finge presentado', () => {
      const html = inlineMarkdown('[el informe](../assets/informe.pdf)', resolver);
      assert.match(html, /class="media-file"/);
      assert.match(html, /data-media-type="application\/pdf"/);
      assert.ok(!html.includes('<img'), `un PDF no es una imagen: ${html}`);
    });

    it('una ruta que Vera no tiene se emite tal cual y degrada sola', () => {
      const html = inlineMarkdown('![x](../assets/ausente.png)', resolver);
      assert.match(html, /<img src="\.\.\/assets\/ausente\.png"/);
    });

    it('sin resolvedor se comporta igual que antes', () => {
      assert.equal(
        inlineMarkdown('![x](../assets/foto.png)'),
        '<img src="../assets/foto.png" alt="x" loading="lazy">',
      );
    });

    it('un enlace externo no pasa por el resolvedor', () => {
      const html = inlineMarkdown('[fuera](https://x.cl/a.png)', resolver);
      assert.match(html, /href="https:\/\/x\.cl\/a\.png"/);
      assert.ok(!html.includes('media-file'));
    });

    it('la URL resuelta se escapa como atributo', () => {
      const html = inlineMarkdown('![x](../assets/foto.png)', {
        resolveAsset: () => ({ url: '/media/a" onerror="alert(1)', mediaType: 'image/png' }),
      });
      const open = /^<img ([^>]*)>/.exec(html)?.[1] ?? '';
      const names = [...open.matchAll(/([a-z-]+)="/g)].map((match) => match[1]);
      assert.deepEqual(names, ['src', 'alt', 'loading'], `atributos: ${open}`);
    });

    it('renderMarkdown propaga el resolvedor a un bloque entero', () => {
      const html = renderMarkdown('# Título\n\n![f](../assets/foto.png)', resolver);
      assert.match(html, /<h2>Título<\/h2>/);
      assert.match(html, new RegExp(`src="/media/${'a'.repeat(64)}"`));
    });

    it('lo propaga también dentro de una lista y de una tabla', () => {
      assert.match(
        renderMarkdown('- ![f](../assets/foto.png)', resolver),
        new RegExp(`<ul><li><img src="/media/${'a'.repeat(64)}"`),
      );
      assert.match(
        renderMarkdown('| a |\n| --- |\n| ![f](../assets/foto.png) |', resolver),
        new RegExp(`<td><img src="/media/${'a'.repeat(64)}"`),
      );
    });
  });

  describe('notas al pie', () => {
    it('convierte la referencia en un salto al destino', () => {
      assert.equal(
        inlineMarkdown('afirmación[^3]'),
        'afirmación<sup class="fnref"><a href="#fn-3">3</a></sup>',
      );
    });

    it('acepta varias referencias seguidas, como en el corpus', () => {
      const html = inlineMarkdown('artefactos.[^3], [^5]');
      assert.match(html, /href="#fn-3"/);
      assert.match(html, /href="#fn-5"/);
    });

    it('no le pone id a la referencia, para no repetirlo entre bloques', () => {
      assert.ok(!inlineMarkdown('x[^1]').includes('id='));
    });
  });
});

describe('renderMarkdown', () => {
  describe('encabezados', () => {
    it('baja un nivel, porque el título de la página ya es el h1', () => {
      assert.equal(renderMarkdown('# Sección'), '<h2>Sección</h2>');
      assert.equal(renderMarkdown('## Sub'), '<h3>Sub</h3>');
    });

    it('no pasa de h6', () => {
      assert.equal(renderMarkdown('###### hondo'), '<h6>hondo</h6>');
    });

    it('no toma por encabezado una almohadilla sin espacio', () => {
      assert.equal(renderMarkdown('#etiqueta'), '<p><span class="tag">#etiqueta</span></p>');
    });

    it('renderiza las marcas de línea dentro del encabezado', () => {
      assert.equal(renderMarkdown('# ver [[Otra]]'),
        '<h2>ver <a class="wiki" data-page="Otra" href="#">Otra</a></h2>');
    });
  });

  describe('listas', () => {
    it('agrupa viñetas en una sola lista', () => {
      assert.equal(renderMarkdown('- uno\n- dos'), '<ul><li>uno</li><li>dos</li></ul>');
    });

    it('reconoce la lista numerada', () => {
      assert.equal(renderMarkdown('1. uno\n2. dos'), '<ol><li>uno</li><li>dos</li></ol>');
    });

    it('anida por sangría', () => {
      assert.equal(
        renderMarkdown('- uno\n  - hijo\n- dos'),
        '<ul><li>uno<ul><li>hijo</li></ul></li><li>dos</li></ul>',
      );
    });

    it('cierra la ordenada con su propia etiqueta', () => {
      const html = renderMarkdown('- uno\n  1. hijo\n- dos');
      assert.ok(html.includes('</ol>'), `debe cerrar con </ol>: ${html}`);
      assert.equal((html.match(/<ol>/g) ?? []).length, (html.match(/<\/ol>/g) ?? []).length);
      assert.equal((html.match(/<ul>/g) ?? []).length, (html.match(/<\/ul>/g) ?? []).length);
    });
  });

  describe('código', () => {
    it('no renderiza marcas dentro de un bloque cercado', () => {
      assert.equal(
        renderMarkdown('```\n**no** [[tampoco]]\n```'),
        '<pre><code>**no** [[tampoco]]</code></pre>',
      );
    });

    it('conserva el lenguaje declarado', () => {
      assert.equal(
        renderMarkdown('```ts\nconst a = 1;\n```'),
        '<pre><code class="language-ts">const a = 1;</code></pre>',
      );
    });

    it('escapa el HTML del ejemplo', () => {
      assert.equal(
        renderMarkdown('```\n<img src=x onerror=alert(1)>\n```'),
        '<pre><code>&lt;img src=x onerror=alert(1)&gt;</code></pre>',
      );
    });

    it('cierra un cercado sin cerrar al terminar el bloque', () => {
      assert.equal(renderMarkdown('```\nabierto'), '<pre><code>abierto</code></pre>');
    });
  });

  describe('tablas', () => {
    it('exige la fila separadora', () => {
      const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
      assert.match(html, /<table>/);
      assert.match(html, /<th>a<\/th><th>b<\/th>/);
      assert.match(html, /<td>1<\/td><td>2<\/td>/);
    });

    it('no toma por tabla un texto con barras', () => {
      const html = renderMarkdown('a | b | c');
      assert.ok(!html.includes('<table>'), `no es una tabla: ${html}`);
    });

    it('envuelve la tabla para que desborde sola', () => {
      assert.match(renderMarkdown('| a |\n| --- |\n| 1 |'), /<div class="table-scroll">/);
    });
  });

  describe('citas y líneas', () => {
    it('agrupa líneas consecutivas en una cita', () => {
      assert.equal(renderMarkdown('> una\n> otra'), '<blockquote>una<br>otra</blockquote>');
    });

    it('reconoce la línea horizontal', () => {
      assert.equal(renderMarkdown('---'), '<hr>');
    });
  });

  describe('notas al pie', () => {
    it('la definición lleva el id al que salta la referencia', () => {
      const html = renderMarkdown('[^3]: Gaver y Bowers, 2012.');
      assert.match(html, /id="fn-3"/);
      assert.match(html, /Gaver y Bowers, 2012\./);
    });

    it('referencia y definición se encuentran en la misma página', () => {
      const ref = inlineMarkdown('afirmación[^3]');
      const def = renderMarkdown('[^3]: la fuente');
      const target = /href="#([^"]+)"/.exec(ref)?.[1];
      assert.ok(target !== undefined);
      assert.ok(def.includes(`id="${target}"`), `${ref} no encuentra a ${def}`);
    });
  });

  describe('párrafos', () => {
    it('separa por línea en blanco', () => {
      assert.equal(renderMarkdown('uno\n\ndos'), '<p>uno</p><p>dos</p>');
    });

    it('conserva el salto suave dentro del párrafo', () => {
      assert.equal(renderMarkdown('uno\ndos'), '<p>uno<br>dos</p>');
    });

    it('devuelve vacío para una fuente vacía', () => {
      assert.equal(renderMarkdown(''), '');
    });
  });

  describe('la fuente manda', () => {
    it('el HTML crudo del corpus se ve, no se ejecuta', () => {
      const html = renderMarkdown('<div onclick="alert(1)">hola</div>');
      assert.ok(!html.includes('<div'), `marcado activo: ${html}`);
      assert.match(html, /&lt;div/);
    });

    it('un iframe queda como texto', () => {
      assert.ok(!renderMarkdown('<iframe src="https://x.cl"></iframe>').includes('<iframe'));
    });
  });
});
