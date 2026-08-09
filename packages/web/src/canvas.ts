// El lienzo: dibujar a mano sobre toda la pantalla.
//
// Ver specs/hand-drawing.allium. Aquí no hay paleta, ni regla de grosores, ni
// selector de color, y no es minimalismo: es que no hay nada que elegir. La
// tinta es el color del texto de la página y el grosor sale de la presión, así
// que las únicas tres cosas que pueden pasar son dibujar, deshacer y salir.
//
// Se dibuja en un `<canvas>` y no en SVG, y la diferencia se nota con el dedo
// apoyado: un elemento nuevo por cada punto obliga al navegador a rehacer el
// árbol sesenta veces por segundo, y el trazo se retrasa de la mano. Al cerrar,
// lo dibujado se vuelve figura —eso sí en SVG, que es lo que se guarda y lo que
// escala— y este lienzo desaparece.
//
// Lo que se dibuja vive aquí y sólo aquí hasta que se cierra. Quien cierre la
// ventana a mitad de un dibujo lo pierde, y eso es lo honesto: nada a medias
// quedó dicho. @guarantee TheGraphIsNotTouchedUntilTheCanvasCloses.

import { NIB, outlineOf, writeDrawing, type Point, type Stroke } from '@vera/core';

/** Cuánto se acerca o se aleja como mucho, con dos dedos. */
const CLOSEST = 8;
const FARTHEST = 0.15;

export interface CanvasResult {
  /** Los trazos escritos como el texto de un bloque. Vacío si no se dibujó nada. */
  content: string;
  strokes: Stroke[];
}

/**
 * Abre el lienzo y devuelve lo dibujado cuando se cierra.
 *
 * Entra lo que ya hubiera —volver a dibujar sobre un dibujo terminado es seguir
 * dibujando, no empezar otro— y sale el texto del bloque, listo para escribirse.
 */
export function openCanvas(already: readonly Stroke[] = []): Promise<CanvasResult> {
  return new Promise((resolve) => {
    const strokes: Stroke[] = already.map((one) => [...one]);

    const shell = document.createElement('div');
    shell.className = 'canvas-shell';
    const canvas = document.createElement('canvas');
    canvas.className = 'canvas-sheet';
    shell.append(canvas);

    /*
     * Un control, y sólo porque salir tiene que poder hacerse con el dedo.
     *
     * Deshacer no lo necesita: con teclado es el atajo de siempre y con la mano
     * es tocar con dos dedos, que es lo que hace un iPad y lo que la gente ya
     * sabe. Un botón para algo que ya tiene gesto es una barra de herramientas
     * empezando.
     */
    const controls = document.createElement('div');
    controls.className = 'canvas-controls';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'canvas-button done';
    done.textContent = 'listo';
    controls.append(done);
    shell.append(controls);
    document.body.append(shell);

    /*
     * La lente: cuánto se acerca y hacia dónde se mira.
     *
     * No queda escrita en ninguna parte. Es cómo se está mirando, no qué se
     * dibujó: al cerrar, el encuadre lo da el recuadro de los trazos.
     * @invariant TheCanvasHasNoEdgeAndNoScale.
     */
    let scale = 1;
    let panX = 0;
    let panY = 0;

    const context = canvas.getContext('2d');
    let ink = '#000';

    /** De la pantalla al dibujo: lo contrario de la lente. */
    const at = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
      const box = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - box.left - panX) / scale,
        y: (event.clientY - box.top - panY) / scale,
      };
    };

    const paint = (): void => {
      if (context === null) return;
      const ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
      context.save();
      context.translate(panX, panY);
      context.scale(scale, scale);
      context.fillStyle = ink;
      for (const stroke of strokes) {
        const outline = outlineOf(stroke, NIB);
        if (outline === '') continue;
        context.fill(new Path2D(outline));
      }
      context.restore();
    };

    const resize = (): void => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(shell.clientWidth * ratio);
      canvas.height = Math.round(shell.clientHeight * ratio);
      canvas.style.width = `${shell.clientWidth}px`;
      canvas.style.height = `${shell.clientHeight}px`;
      // La tinta se lee del tema en cada medida, no una vez: el tema puede
      // cambiar con el lienzo abierto.
      ink = getComputedStyle(document.body).color;
      paint();
    };

    /*
     * Lo que ya estaba, centrado y a la vista.
     *
     * Volver a dibujar sobre algo terminado tiene que empezar por verlo entero:
     * los trazos vienen en coordenadas del dibujo, que no son las de esta
     * pantalla ni las de la pantalla donde se hicieron.
     */
    const frameWhatIsThere = (): void => {
      if (strokes.length === 0) return;
      let left = Infinity;
      let top = Infinity;
      let right = -Infinity;
      let bottom = -Infinity;
      for (const stroke of strokes) {
        for (const point of stroke) {
          left = Math.min(left, point.x);
          top = Math.min(top, point.y);
          right = Math.max(right, point.x);
          bottom = Math.max(bottom, point.y);
        }
      }
      const margin = 60;
      const wide = Math.max(1, right - left);
      const tall = Math.max(1, bottom - top);
      scale = Math.min(
        (shell.clientWidth - margin * 2) / wide,
        (shell.clientHeight - margin * 2) / tall,
        1,
      );
      panX = (shell.clientWidth - wide * scale) / 2 - left * scale;
      panY = (shell.clientHeight - tall * scale) / 2 - top * scale;
    };

    // --- Dibujar ----------------------------------------------------------

    const drawing = new Map<number, Stroke>();
    /** Los dos dedos de un pellizco, mientras dure. */
    const pinching = new Map<number, { x: number; y: number }>();
    /*
     * Y lo que distingue tocar con dos dedos de pellizcar: cuándo empezó y
     * cuánto se movieron. Un toque es corto y quieto; un pellizco separa los
     * dedos o arrastra. Sin medir las dos cosas, cada intento de acercar la
     * imagen borraría un trazo.
     */
    let twoFingers: { at: number; x: number; y: number; moved: number } | null = null;
    let pinchFrom: { gap: number; midX: number; midY: number; scale: number; panX: number; panY: number } | null = null;

    const sample = (event: PointerEvent): Point => {
      const point = at(event);
      /*
       * La presión, tal como la informa el aparato.
       *
       * Un ratón y un dedo sin sensor informan 0.5 —o 0 en algunos navegadores—
       * y eso vale como respuesta: el trazo sale parejo y sigue siendo legible.
       * No se le inventa una presión a un ratón, que sería dibujar por quien
       * dibuja. @invariant PressureTravelsWithThePoint.
       */
      const said = event.pointerType === 'pen' ? event.pressure : 0.5;
      return { x: point.x, y: point.y, pressure: said > 0 ? said : 0.5 };
    };

    canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        pinching.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pinching.size === 2) {
          /*
           * El segundo dedo convierte en otra cosa lo que el primero empezó.
           *
           * Y hay que quitarlo de los trazos, no sólo dejar de seguirlo: el
           * primer dedo ya había apoyado, así que existe un trazo de un punto.
           * Sin esto, acercar la imagen dejaba un lunar en el dibujo, y tocar
           * con dos dedos deshacía ese lunar en vez del trazo anterior.
           */
          for (const started of drawing.values()) {
            const at = strokes.indexOf(started);
            if (at !== -1) strokes.splice(at, 1);
          }
          drawing.clear();
          const [a, b] = [...pinching.values()];
          if (a !== undefined && b !== undefined) {
            twoFingers = { at: Date.now(), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, moved: 0 };
            pinchFrom = {
              gap: Math.hypot(a.x - b.x, a.y - b.y),
              midX: (a.x + b.x) / 2,
              midY: (a.y + b.y) / 2,
              scale,
              panX,
              panY,
            };
          }
          paint();
          return;
        }
      }
      if (pinching.size > 1) return;
      canvas.setPointerCapture(event.pointerId);
      const stroke: Stroke = [sample(event)];
      undone.length = 0;
      drawing.set(event.pointerId, stroke);
      strokes.push(stroke);
      paint();
    });

    canvas.addEventListener('pointermove', (event) => {
      if (pinching.has(event.pointerId)) {
        pinching.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pinchFrom !== null && pinching.size === 2) {
        const [a, b] = [...pinching.values()];
        if (a === undefined || b === undefined) return;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        if (twoFingers !== null) {
          twoFingers.moved = Math.max(
            twoFingers.moved,
            Math.abs(gap - pinchFrom.gap) + Math.hypot(midX - twoFingers.x, midY - twoFingers.y),
          );
        }
        const grown = Math.max(FARTHEST, Math.min(CLOSEST, pinchFrom.scale * (gap / pinchFrom.gap)));
        const factor = grown / pinchFrom.scale;
        // Se acerca hacia donde están los dedos, no hacia el centro de la
        // pantalla: es lo que hace que acercarse sirva para llegar a un detalle.
        panX = midX - (pinchFrom.midX - pinchFrom.panX) * factor;
        panY = midY - (pinchFrom.midY - pinchFrom.panY) * factor;
        scale = grown;
        paint();
        return;
      }
      const stroke = drawing.get(event.pointerId);
      if (stroke === undefined) return;
      /*
       * Los puntos intermedios que el navegador guardó.
       *
       * Un dedo rápido produce más muestras de las que llegan como eventos, y
       * sin esto el trazo sale poligonal en las curvas. Donde no existan, el
       * evento mismo es la única muestra que hubo.
       */
      const many = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const points = many.length > 0 ? many : [event];
      for (const one of points) {
        const point = sample(one as PointerEvent);
        const last = stroke.at(-1);
        // Dos muestras en el mismo sitio no dicen nada y engordan el bloque.
        if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) * scale < 0.7) {
          continue;
        }
        stroke.push(point);
      }
      paint();
    });

    const liftPointer = (event: PointerEvent): void => {
      /*
       * Dos dedos que se posan y se levantan sin hacer nada son un deshacer.
       *
       * Es el gesto que ya hace un iPad y que la gente trae aprendido, y aquí
       * hace falta porque con la mano no hay atajo de teclado que pulsar. Corto
       * y quieto: si se movieron o se separaron, era un pellizco y lo que hizo
       * fue mirar más de cerca.
       */
      if (twoFingers !== null && pinching.size === 2) {
        const quick = Date.now() - twoFingers.at < 350;
        if (quick && twoFingers.moved < 14) undoStroke();
        twoFingers = null;
      }
      pinching.delete(event.pointerId);
      if (pinching.size < 2) pinchFrom = null;
      const stroke = drawing.get(event.pointerId);
      drawing.delete(event.pointerId);
      if (stroke !== undefined && stroke.length === 0) {
        const at = strokes.indexOf(stroke);
        if (at !== -1) strokes.splice(at, 1);
      }
    };
    canvas.addEventListener('pointerup', liftPointer);
    canvas.addEventListener('pointercancel', liftPointer);
    canvas.addEventListener('pointerleave', liftPointer);

    // --- Deshacer y salir --------------------------------------------------

    /*
     * Deshacer aquí quita el último trazo y no toca el grafo: todavía no hay
     * nada escrito. @invariant TheCanvasHasItsOwnUndo.
     *
     * Y rehacer lo devuelve, porque un trazo quitado por error no puede obligar
     * a rehacerlo con la mano: no saldría igual. Lo deshecho espera en su pila
     * hasta que se dibuje otra cosa, que es cuando deja de tener sentido volver.
     */
    const undone: Stroke[] = [];
    const undoStroke = (): void => {
      const last = strokes.pop();
      if (last !== undefined) undone.push(last);
      paint();
    };
    const redoStroke = (): void => {
      const back = undone.pop();
      if (back !== undefined) strokes.push(back);
      paint();
    };

    const shut = (): void => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKey, true);
      shell.remove();
      resolve({ content: writeDrawing(strokes), strokes });
    };

    /*
     * Salir y aceptar son el mismo gesto.
     *
     * No hay una tecla que guarde y otra que tire, porque en un dibujo hecho a
     * mano no existe el momento en que uno decide si lo quiere: ya lo hizo. Lo
     * que no se quiera se deshace. @invariant BothGesturesFinish.
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        shut();
        return;
      }
      if ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redoStroke();
        else undoStroke();
      }
    }
    document.addEventListener('keydown', onKey, true);
    done.addEventListener('click', shut);

    window.addEventListener('resize', resize);
    resize();
    frameWhatIsThere();
    paint();
  });
}
