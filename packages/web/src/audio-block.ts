// El audio dentro del texto.
//
// Una grabación pegada a un bloque, y el texto de ese bloque debajo. El audio se
// oye ahí mismo mientras exista, el texto se edita como cualquier otro texto, y
// ninguna de las dos cosas consume a la otra.
//
// @guarantee ThreeThingsAndNoMore: transcribir, volver a transcribir, borrar el
// audio. No hay estado que avanzar ni paso que completar antes de poder seguir
// escribiendo; lo demás es la edición ordinaria de un bloque ordinario.

import { audioUrl, startRecording, voice, type Recording } from './voice.ts';

export interface AudioBlockHandlers {
  /** Volver a traer la página: transcribir escribe el texto del bloque. */
  onSettled(): void;
  notify(message: string): void;
  /** La grabación cambió sin que el árbol se mueva. */
  onChanged(recording: Recording): void;
}

/*
 * Si hay una grabación en curso, y quién quiere enterarse.
 *
 * Vive aquí porque aquí es donde se sabe. La barra necesita decirlo —el botón de
 * hablar se pone verde mientras se graba— y sin esto tendría que adivinarlo
 * mirando el DOM, que es preguntarle a la consecuencia por la causa.
 *
 * Se enciende cuando la grabación ha empezado de verdad, no al pulsar: entre una
 * cosa y otra está el permiso del micrófono, que puede negarse. Un botón que se
 * pone verde antes de que haya micrófono está diciendo algo que todavía no es
 * cierto, y en una interfaz de voz esa mentira cuesta lo que se dijo creyéndola.
 */
let live = false;
const watchers = new Set<(on: boolean) => void>();

/** Avisa cuando una grabación empieza o termina. */
export function onRecording(watcher: (on: boolean) => void): void {
  watchers.add(watcher);
  watcher(live);
}

function setLive(on: boolean): void {
  if (live === on) return;
  live = on;
  for (const watcher of watchers) watcher(on);
}

/** Lo que duró, en minutos y segundos. */
function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function action(label: string, kind: 'plain' | 'primary' | 'quiet' = 'plain'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'plain' ? 'audio-action' : `audio-action ${kind}`;
  button.textContent = label;
  return button;
}

/**
 * Graba en el sitio, y al detener deja el audio pegado a este bloque.
 *
 * Empieza sola: escribir `/audio` o pulsar el micrófono es haber decidido
 * hablar, y pedir un segundo clic para lo ya decidido sólo pone tiempo entre la
 * intención y la voz.
 */
export function renderRecorder(
  host: HTMLElement,
  block: string,
  handlers: AudioBlockHandlers,
): void {
  const box = document.createElement('div');
  box.className = 'audio-block recording';
  host.innerHTML = '';
  host.append(box);

  const dot = document.createElement('span');
  dot.className = 'audio-dot';

  const elapsed = document.createElement('span');
  elapsed.className = 'audio-time';
  elapsed.textContent = '0:00';

  const stop = action('detener', 'primary');
  const cancel = action('descartar', 'quiet');
  box.append(dot, elapsed, stop, cancel);

  const began = Date.now();
  const tick = window.setInterval(() => {
    elapsed.textContent = clock(Date.now() - began);
  }, 500);

  void startRecording().then((started) => {
    if ('error' in started) {
      window.clearInterval(tick);
      setLive(false);
      handlers.notify(started.error);
      host.innerHTML = '';
      return;
    }

    // Hay micrófono y está entrando sonido: ahora sí.
    setLive(true);

    cancel.addEventListener('click', () => {
      window.clearInterval(tick);
      setLive(false);
      started.cancel();
      // Nada que guardar: no llegó a haber grabación.
      host.innerHTML = '';
      handlers.onSettled();
    });

    stop.addEventListener('click', () => {
      window.clearInterval(tick);
      // Se apaga al detener y no al terminar de guardar: lo que el verde dice es
      // «te estoy oyendo», y ya no.
      setLive(false);
      stop.disabled = true;
      cancel.disabled = true;
      elapsed.textContent = 'guardando…';
      void started.stop().then(async ({ audio, durationMs }) => {
        const captured = await voice.capture(audio, durationMs, block);
        if ('error' in captured) {
          handlers.notify(captured.error);
          host.innerHTML = '';
          return;
        }
        handlers.onSettled();
      });
    });
  });
}

/**
 * El audio de un bloque: reproductor y tres botones.
 *
 * Se dibuja *encima* del texto del bloque, no en su lugar. El bloque se sigue
 * leyendo y editando como cualquier otro, y esto es lo que tiene pegado.
 *
 * @invariant TheRecordingStaysUntilItIsDiscarded: nada de aquí consume la
 * grabación. Sólo la borra el botón que dice que la borra.
 */
export function renderAudioBlock(
  host: HTMLElement,
  recording: Recording,
  handlers: AudioBlockHandlers,
  /** Lo que el bloque dice ahora, para saber si alguien lo editó a mano. */
  blockText = '',
): void {
  const box = document.createElement('div');
  box.className = 'audio-block';
  host.append(box);

  const fail = (outcome: unknown): boolean => {
    if (outcome !== null && typeof outcome === 'object' && 'error' in outcome) {
      handlers.notify(String((outcome as { error: string }).error));
      return true;
    }
    return false;
  };

  const url = audioUrl(recording);
  if (url !== null) {
    const player = document.createElement('audio');
    player.controls = true;
    player.preload = 'metadata';
    player.src = url;
    player.className = 'audio-player';
    box.append(player);
  } else {
    // El audio se borró. La grabación sigue existiendo y lo dice, en vez de
    // desaparecer y dejar el bloque sin explicación de por qué está marcado.
    const gone = document.createElement('span');
    gone.className = 'audio-meta';
    gone.textContent = 'el audio se borró · queda lo que dice y de dónde vino';
    box.append(gone);
  }

  const row = document.createElement('div');
  row.className = 'audio-row';

  const said = document.createElement('span');
  said.className = 'audio-meta';
  said.textContent =
    recording.durationMs === null
      ? new Date(recording.capturedAt).toLocaleString('es')
      : `${clock(recording.durationMs)} · ${new Date(recording.capturedAt).toLocaleString('es')}`;
  row.append(said);

  if (recording.audioHash !== null) {
    // Transcribir por primera vez, o volver a hacerlo. Es el mismo acto: escribe
    // el texto del bloque y no toca el audio.
    const again = recording.transcript !== null;
    const ask = action(again ? 'retranscribir' : 'transcribir', again ? 'plain' : 'primary');
    ask.addEventListener('click', () => {
      // @guarantee WhatWillBeLostIsSaidBeforeItIsLost: lo que se pierde al
      // retranscribir es lo que una persona escribió encima. Sólo se advierte si
      // de verdad hay algo así: avisar siempre enseña a no leer los avisos.
      const edited =
        again && blockText.trim() !== '' && blockText.trim() !== (recording.transcript ?? '').trim();
      if (edited && !window.confirm('El texto de este bloque se editó a mano. Retranscribir lo reemplaza. ¿Seguir?')) {
        return;
      }
      ask.disabled = true;
      ask.textContent = 'transcribiendo…';
      void voice.transcribe(recording.id).then((next) => {
        if (fail(next)) {
          ask.disabled = false;
          ask.textContent = again ? 'retranscribir' : 'transcribir';
          return;
        }
        handlers.onSettled();
      });
    });
    row.append(ask);

    const drop = action('borrar el audio', 'quiet');
    drop.title = 'La grabación deja de poder oírse. Lo escrito sigue escrito.';
    drop.addEventListener('click', () => {
      // Sin transcripción, borrar el audio no deja nada. Con ella, deja el texto.
      const nothingKept = recording.transcript === null && blockText.trim() === '';
      const warning = nothingKept
        ? 'Este audio no se ha transcrito: al borrarlo no queda nada de lo que se dijo. ¿Seguir?'
        : 'El audio deja de poder oírse. El texto y su procedencia se quedan. ¿Seguir?';
      if (!window.confirm(warning)) return;
      drop.disabled = true;
      void voice.discardAudio(recording.id).then((next) => {
        if (fail(next)) {
          drop.disabled = false;
          return;
        }
        handlers.onSettled();
      });
    });
    row.append(drop);
  }

  box.append(row);
}
