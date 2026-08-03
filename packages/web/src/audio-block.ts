// El audio dentro del texto: un bloque que guarda su lugar mientras se habla.
//
// Es la misma cascada del panel de voz, dibujada donde se estaba escribiendo. La
// diferencia no es de pasos —son los mismos, y cada uno lo confirma una persona—
// sino de sitio: el audio se oye donde se dijo, y lo asentado cae ahí mismo.
//
// @invariant EveryLinkIsHumanlyConfirmed: ningún botón hace dos eslabones.
// @guarantee TheRecordingIsAlwaysReachable: mientras el audio exista, se oye
// desde donde se lee lo que dice.

import { audioUrl, startRecording, voice, type Recording } from './voice.ts';

export interface AudioBlockHandlers {
  /** Volver a traer la página: lo asentado son bloques del grafo. */
  onSettled(): void;
  notify(message: string): void;
  /** La grabación cambió de eslabón sin cambiar el árbol. */
  onChanged(recording: Recording): void;
}

/** Lo que duró, en minutos y segundos. */
function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function shell(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'audio-block';
  return box;
}

function action(label: string, kind: 'plain' | 'primary' | 'quiet' = 'plain'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'plain' ? 'audio-action' : `audio-action ${kind}`;
  button.textContent = label;
  return button;
}

/**
 * Graba en el sitio, y al detener sube el audio atado a este bloque.
 *
 * Empieza sola: escribir `/audio` es haber decidido hablar, y pedir un segundo
 * clic para lo ya decidido sólo pone tiempo entre la intención y la voz.
 */
export function renderRecorder(
  host: HTMLElement,
  block: string,
  handlers: AudioBlockHandlers,
): void {
  const box = shell();
  box.classList.add('recording');
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
      handlers.notify(started.error);
      host.innerHTML = '';
      return;
    }

    cancel.addEventListener('click', () => {
      window.clearInterval(tick);
      started.cancel();
      // Nada que guardar: no hubo grabación, así que no hay eslabón que romper.
      host.innerHTML = '';
      handlers.onSettled();
    });

    stop.addEventListener('click', () => {
      window.clearInterval(tick);
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
        renderAudioBlock(host, captured, handlers);
      });
    });
  });
}

/**
 * El audio y lo que falta para el eslabón siguiente.
 *
 * Cada estado ofrece un solo paso. No hay un botón que transcriba, valide y
 * asiente: juntarlos sería fingir que la máquina puede declarar en nombre de
 * quien habló.
 */
export function renderAudioBlock(
  host: HTMLElement,
  recording: Recording,
  handlers: AudioBlockHandlers,
): void {
  const box = shell();
  host.innerHTML = '';
  host.append(box);

  const redraw = (next: Recording): void => renderAudioBlock(host, next, handlers);

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
  }

  const said = document.createElement('span');
  said.className = 'audio-meta';
  said.textContent =
    recording.durationMs === null
      ? new Date(recording.capturedAt).toLocaleString('es')
      : `${clock(recording.durationMs)} · ${new Date(recording.capturedAt).toLocaleString('es')}`;
  box.append(said);

  const row = document.createElement('div');
  row.className = 'audio-row';
  box.append(row);

  // ---- Grabado: pedir la transcripción ------------------------------------
  if (recording.stage === 'captured') {
    const ask = action('transcribir', 'primary');
    ask.title = 'whisper.cpp corre en esta máquina; el audio no sale de ella';
    ask.addEventListener('click', () => {
      ask.disabled = true;
      ask.textContent = 'transcribiendo…';
      void voice.transcribe(recording.id).then((next) => {
        if (fail(next)) {
          ask.disabled = false;
          ask.textContent = 'transcribir';
          return;
        }
        redraw(next as Recording);
      });
    });
    row.append(ask);
    return;
  }

  // ---- Transcrito: corregir hasta que diga lo que se dijo -------------------
  if (recording.stage === 'transcribed') {
    const field = document.createElement('textarea');
    field.className = 'audio-transcript';
    field.value = recording.transcript ?? '';
    field.rows = 6;
    field.setAttribute('aria-label', 'transcripción propuesta');
    box.insertBefore(field, row);

    const hint = document.createElement('p');
    hint.className = 'audio-hint';
    hint.textContent =
      'Corrígela hasta que diga lo que dijiste. Una línea en blanco separa un bloque del siguiente.';
    box.insertBefore(hint, row);

    const save = action('guardar corrección');
    save.addEventListener('click', () => {
      void voice.correct(recording.id, field.value).then((next) => {
        if (fail(next)) return;
        handlers.notify('corrección guardada');
        handlers.onChanged(next as Recording);
      });
    });

    const confirm = action('dice lo que dije', 'primary');
    confirm.addEventListener('click', () => {
      void voice.correct(recording.id, field.value).then(async (saved) => {
        if (fail(saved)) return;
        const next = await voice.validate(recording.id);
        if (fail(next)) return;
        redraw(next as Recording);
      });
    });

    row.append(save, confirm);
    return;
  }

  // ---- Validado: asentarlo aquí --------------------------------------------
  if (recording.stage === 'transcript_validated') {
    const text = document.createElement('pre');
    text.className = 'audio-settled';
    text.textContent = recording.transcript ?? '';
    box.insertBefore(text, row);

    const settle = action('asentar aquí', 'primary');
    settle.title = 'el texto pasa a ser este bloque, y nombra esta grabación';
    settle.addEventListener('click', () => {
      settle.disabled = true;
      void voice.settle(recording.id).then((next) => {
        if (fail(next)) {
          settle.disabled = false;
          return;
        }
        handlers.onSettled();
      });
    });
    row.append(settle);
    return;
  }

  // ---- Asentado: el audio ya puede irse, si se quiere -----------------------
  const done = document.createElement('span');
  done.className = 'audio-meta';
  done.textContent = 'el contenido ya vive en la página y nombra esta grabación';
  row.append(done);

  if (recording.audioHash !== null) {
    const drop = action('borrar el audio', 'quiet');
    drop.title = 'queda la transcripción validada y el contenido, que siguen diciendo de dónde vino';
    drop.addEventListener('click', () => {
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
}
