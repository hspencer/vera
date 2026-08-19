// El lienzo: dibujar a mano sobre toda la pantalla.
//
// Ver specs/hand-drawing.allium. Aquí no hay paleta, ni regla de grosores, ni
// selector de color. La
// tinta es el color del texto de la página y el grosor sale de la presión, así
// que sólo se elige entre dejar tinta y retirar un trazo con la goma.
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

import { NIB, segmentsOf, widthAt, writeDrawing, type Point, type Stroke } from '@vera/core';

import { icon } from './icons.ts';

/** Cuánto se acerca o se aleja como mucho, con dos dedos. */
const CLOSEST = 8;
const FARTHEST = 0.15;
/** La goma se siente deliberadamente más ancha que la punta, en píxeles de pantalla. */
export const ERASER_RADIUS = 24;

export interface CanvasResult {
  /** Los trazos escritos como el texto de un bloque. Vacío si no se dibujó nada. */
  content: string;
  strokes: Stroke[];
}

/**
 * Añade una muestra a mano alzada o desplaza el único extremo de una recta.
 *
 * Está fuera del listener para fijar con pruebas la diferencia estructural: una
 * recta no es una polilínea que por casualidad quedó derecha.
 */
export function extendStroke(stroke: Stroke, point: Point, straight: boolean): void {
  if (!straight || stroke.length === 0) {
    stroke.push(point);
    return;
  }
  if (stroke.length === 1) stroke.push(point);
  else stroke.splice(1, stroke.length - 1, point);
}

/** Distancia desde un punto al tramo finito entre otros dos. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const along = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (from.x + along * dx), point.y - (from.y + along * dy));
}

/**
 * Quita los trazos que toca la goma y devuelve cuáles fueron, con su lugar.
 *
 * Es una goma vectorial: retira el gesto entero al tocarlo. No corta la línea en
 * cientos de fragmentos ni convierte el dibujo en píxeles.
 */
export function eraseStrokesAt(
  strokes: Stroke[],
  point: Point,
  radius: number,
): Array<{ stroke: Stroke; index: number }> {
  const removed: Array<{ stroke: Stroke; index: number }> = [];
  for (let index = strokes.length - 1; index >= 0; index -= 1) {
    const stroke = strokes[index]!;
    const touched = stroke.some((sample, at) => {
      if (Math.hypot(point.x - sample.x, point.y - sample.y) <= radius) return true;
      const next = stroke[at + 1];
      return next !== undefined && distanceToSegment(point, sample, next) <= radius;
    });
    if (!touched) continue;
    removed.unshift({ stroke, index });
    strokes.splice(index, 1);
  }
  return removed;
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

    const controls = document.createElement('div');
    controls.className = 'canvas-controls';
    const tools = document.createElement('div');
    tools.className = 'canvas-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'herramienta de dibujo');
    const pencil = document.createElement('button');
    pencil.type = 'button';
    pencil.className = 'canvas-button canvas-tool active';
    pencil.innerHTML = icon('edit-2');
    pencil.title = 'lápiz';
    pencil.setAttribute('aria-label', 'dibujar con lápiz');
    pencil.setAttribute('aria-pressed', 'true');
    const eraser = document.createElement('button');
    eraser.type = 'button';
    eraser.className = 'canvas-button canvas-tool';
    eraser.innerHTML = icon('eraser');
    eraser.title = 'borrador';
    eraser.setAttribute('aria-label', 'borrar trazos');
    eraser.setAttribute('aria-pressed', 'false');
    tools.append(pencil, eraser);
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'canvas-button done';
    /*
     * El visto, y no la palabra «listo».
     *
     * Salir y aceptar son el mismo gesto —@invariant BothGesturesFinish—, así
     * que el control dice «aceptar», que es lo que el visto significa en toda la
     * interfaz. Una palabra además obliga a leer para saber qué hace el único
     * botón de una pantalla donde lo único que se puede hacer es dibujar; una
     * marca se reconoce con el dibujo todavía en la mano.
     */
    done.innerHTML = icon('check');
    done.title = 'listo';
    done.setAttribute('aria-label', 'listo, guardar el dibujo');
    controls.append(tools, done);
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
    let tool: 'pencil' | 'eraser' = 'pencil';
    let eraserPoint: Point | null = null;

    const chooseTool = (chosen: 'pencil' | 'eraser'): void => {
      tool = chosen;
      pencil.classList.toggle('active', chosen === 'pencil');
      eraser.classList.toggle('active', chosen === 'eraser');
      pencil.setAttribute('aria-pressed', String(chosen === 'pencil'));
      eraser.setAttribute('aria-pressed', String(chosen === 'eraser'));
      canvas.classList.toggle('erasing', chosen === 'eraser');
      eraserPoint = null;
      paint();
    };
    pencil.addEventListener('click', () => chooseTool('pencil'));
    eraser.addEventListener('click', () => chooseTool('eraser'));

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
      context.strokeStyle = ink;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const stroke of strokes) {
        if (stroke.length === 1) {
          const point = stroke[0]!;
          context.beginPath();
          context.arc(point.x, point.y, widthAt(point.pressure, NIB) / 2, 0, Math.PI * 2);
          context.fill();
          continue;
        }
        for (const segment of segmentsOf(stroke, NIB)) {
          context.beginPath();
          context.moveTo(segment.from.x, segment.from.y);
          context.lineTo(segment.to.x, segment.to.y);
          context.lineWidth = segment.width;
          context.stroke();
        }
      }
      if (tool === 'eraser' && eraserPoint !== null) {
        context.beginPath();
        context.arc(eraserPoint.x, eraserPoint.y, ERASER_RADIUS / scale, 0, Math.PI * 2);
        context.lineWidth = 1 / scale;
        context.strokeStyle = ink;
        context.stroke();
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

    type CanvasAction =
      | { kind: 'draw'; stroke: Stroke; index: number }
      | { kind: 'erase'; before: Stroke[]; after: Stroke[] };
    const history: CanvasAction[] = [];
    const future: CanvasAction[] = [];
    const drawing = new Map<number, Stroke>();
    const erasing = new Set<number>();
    const erased = new Map<number, Stroke[]>();
    /** Punteros cuyo trazo ya se convirtió en recta durante este apoyo. */
    const straightening = new Set<number>();
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
            const action = history.findLastIndex((one) => one.kind === 'draw' && one.stroke === started);
            if (action !== -1) history.splice(action, 1);
          }
          drawing.clear();
          for (const before of erased.values()) {
            strokes.splice(0, strokes.length, ...before);
          }
          erased.clear();
          erasing.clear();
          straightening.clear();
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
      if (tool === 'eraser') {
        const point = sample(event);
        eraserPoint = point;
        future.length = 0;
        erasing.add(event.pointerId);
        erased.set(event.pointerId, [...strokes]);
        eraseStrokesAt(strokes, point, ERASER_RADIUS / scale);
        paint();
        return;
      }
      const stroke: Stroke = [sample(event)];
      if (event.shiftKey) straightening.add(event.pointerId);
      future.length = 0;
      drawing.set(event.pointerId, stroke);
      strokes.push(stroke);
      history.push({ kind: 'draw', stroke, index: strokes.length - 1 });
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
      if (tool === 'eraser') {
        eraserPoint = sample(event);
        if (erasing.has(event.pointerId)) {
          eraseStrokesAt(strokes, eraserPoint, ERASER_RADIUS / scale);
        }
        paint();
        return;
      }
      const stroke = drawing.get(event.pointerId);
      if (stroke === undefined) return;
      if (event.shiftKey) straightening.add(event.pointerId);
      /*
       * Los puntos intermedios que el navegador guardó.
       *
       * Un dedo rápido produce más muestras de las que llegan como eventos, y
       * sin esto el trazo sale poligonal en las curvas. Donde no existan, el
       * evento mismo es la única muestra que hubo.
       */
      const many = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const points = many.length > 0 ? many : [event];
      if (straightening.has(event.pointerId)) {
        const end = points.at(-1);
        if (end !== undefined) extendStroke(stroke, sample(end as PointerEvent), true);
        paint();
        return;
      }
      for (const one of points) {
        const point = sample(one as PointerEvent);
        const last = stroke.at(-1);
        // Dos muestras en el mismo sitio no dicen nada y engordan el bloque.
        if (last !== undefined && Math.hypot(point.x - last.x, point.y - last.y) * scale < 0.7) {
          continue;
        }
        extendStroke(stroke, point, false);
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
      if (stroke !== undefined && (straightening.has(event.pointerId) || event.shiftKey)) {
        straightening.add(event.pointerId);
        extendStroke(stroke, sample(event), true);
      }
      drawing.delete(event.pointerId);
      erasing.delete(event.pointerId);
      const before = erased.get(event.pointerId);
      if (before !== undefined) {
        if (before.length !== strokes.length || before.some((one, index) => strokes[index] !== one)) {
          history.push({ kind: 'erase', before, after: [...strokes] });
        }
        erased.delete(event.pointerId);
      }
      straightening.delete(event.pointerId);
      if (stroke !== undefined && stroke.length === 0) {
        const at = strokes.indexOf(stroke);
        if (at !== -1) strokes.splice(at, 1);
      }
    };
    canvas.addEventListener('pointerup', liftPointer);
    canvas.addEventListener('pointercancel', liftPointer);
    canvas.addEventListener('pointerleave', (event) => {
      eraserPoint = null;
      liftPointer(event);
      paint();
    });

    // --- Deshacer y salir --------------------------------------------------

    /*
     * Deshacer aquí quita el último trazo y no toca el grafo: todavía no hay
     * nada escrito. @invariant TheCanvasHasItsOwnUndo.
     *
     * Y rehacer lo devuelve, porque un trazo quitado por error no puede obligar
     * a rehacerlo con la mano: no saldría igual. Lo deshecho espera en su pila
     * hasta que se dibuje otra cosa, que es cuando deja de tener sentido volver.
     */
    const undoStroke = (): void => {
      let action = history.pop();
      if (action === undefined) {
        const stroke = strokes.pop();
        if (stroke !== undefined) action = { kind: 'draw', stroke, index: strokes.length };
      } else if (action.kind === 'draw') {
        const at = strokes.indexOf(action.stroke);
        if (at !== -1) strokes.splice(at, 1);
      } else {
        strokes.splice(0, strokes.length, ...action.before);
      }
      if (action !== undefined) future.push(action);
      paint();
    };
    const redoStroke = (): void => {
      const action = future.pop();
      if (action === undefined) return;
      if (action.kind === 'draw') {
        strokes.splice(Math.min(action.index, strokes.length), 0, action.stroke);
      } else {
        strokes.splice(0, strokes.length, ...action.after);
      }
      history.push(action);
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
