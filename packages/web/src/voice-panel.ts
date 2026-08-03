// El panel de la cascada: lo que se ve al insertar voz.
//
// Enseña en qué eslabón va la grabación y qué falta para el siguiente. No hay
// un botón que lo haga todo, a propósito: cada paso es una confirmación humana,
// y juntarlos en uno sería fingir que la máquina puede validar por su cuenta.

import {
  audioUrl,
  startRecording,
  STAGES,
  voice,
  type Recording,
} from './voice.ts';

export interface VoicePanelHandlers {
  /** La página donde se asentará el contenido. */
  page(): { id: string; title: string } | null;
  onSettled(blocks: string[]): void;
  notify(message: string): void;
  onClose(): void;
}

let stopper: Awaited<ReturnType<typeof startRecording>> | null = null;

export function renderVoicePanel(
  host: HTMLElement,
  recording: Recording | null,
  handlers: VoicePanelHandlers,
): void {
  host.innerHTML = '';
  host.hidden = false;

  const head = document.createElement('header');
  head.className = 'settings-head';
  const title = document.createElement('h2');
  title.textContent = 'Insertar voz';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.textContent = 'cerrar';
  close.addEventListener('click', () => {
    if (stopper !== null && 'cancel' in stopper) stopper.cancel();
    stopper = null;
    handlers.onClose();
  });
  head.append(title, close);
  host.append(head);

  const body = document.createElement('div');
  body.className = 'settings-body';
  host.append(body);

  const note = document.createElement('p');
  note.className = 'settings-note';
  note.textContent =
    'Lo canónico es la cadena: el audio, la transcripción que confirmas que dice lo ' +
    'que dijiste, y el contenido. Lo que escribas después seguirá pudiendo nombrar ' +
    'de dónde vino.';
  body.append(note);

  // La escalera de la cascada, con el eslabón actual marcado.
  const stairs = document.createElement('ol');
  stairs.className = 'cascade';
  const reached = recording === null ? -1 : STAGES.findIndex((s) => s.id === recording.stage);
  for (const [at, stage] of STAGES.entries()) {
    const step = document.createElement('li');
    step.className =
      at < reached ? 'cascade-step done' : at === reached ? 'cascade-step here' : 'cascade-step';
    const label = document.createElement('span');
    label.textContent = stage.label;
    const what = document.createElement('span');
    what.className = 'cascade-what';
    what.textContent = stage.what;
    step.append(label, what);
    stairs.append(step);
  }
  body.append(stairs);

  const redraw = (next: Recording | null): void => renderVoicePanel(host, next, handlers);

  const fail = (outcome: unknown): boolean => {
    if (outcome !== null && typeof outcome === 'object' && 'error' in outcome) {
      handlers.notify(String((outcome as { error: string }).error));
      return true;
    }
    return false;
  };

  // ---- Sin grabación: grabar -------------------------------------------
  if (recording === null) {
    const record = document.createElement('button');
    record.type = 'button';
    record.className = 'voice-record';

    if (stopper === null || 'error' in stopper) {
      record.textContent = '● grabar';
      record.addEventListener('click', () => {
        void startRecording().then((started) => {
          if ('error' in started) {
            handlers.notify(started.error);
            return;
          }
          stopper = started;
          redraw(null);
        });
      });
    } else {
      record.textContent = '■ detener y guardar';
      record.classList.add('recording');
      const held = stopper;
      record.addEventListener('click', () => {
        void held.stop().then(async ({ audio, durationMs }) => {
          stopper = null;
          handlers.notify('guardando el audio…');
          const captured = await voice.capture(audio, durationMs);
          if (fail(captured)) {
            redraw(null);
            return;
          }
          redraw(captured as Recording);
        });
      });
    }
    body.append(record);
    return;
  }

  // ---- El audio, siempre que exista -------------------------------------
  const url = audioUrl(recording);
  if (url !== null) {
    // @guarantee TheRecordingIsAlwaysReachable: se puede oír desde donde se lee
    // lo que dice. Una cadena cuya cabeza no se alcanza es una afirmación.
    const player = document.createElement('audio');
    player.controls = true;
    player.src = url;
    player.className = 'voice-audio';
    body.append(player);
  } else {
    const gone = document.createElement('p');
    gone.className = 'settings-note';
    gone.textContent = 'El audio se descartó. Queda su transcripción validada y lo que se asentó de ella.';
    body.append(gone);
  }

  const evidence = document.createElement('p');
  evidence.className = 'voice-evidence';
  evidence.textContent = `${recording.evidence.reference} · ${new Date(
    recording.evidence.capturedAt,
  ).toLocaleString('es')}`;
  body.append(evidence);

  // ---- Grabado: pedir la transcripción ----------------------------------
  if (recording.stage === 'captured') {
    const ask = document.createElement('button');
    ask.type = 'button';
    ask.className = 'voice-action';
    ask.textContent = 'transcribir aquí mismo';
    ask.title = 'whisper.cpp corre en esta máquina; el audio no sale de ella';
    ask.addEventListener('click', () => {
      ask.disabled = true;
      ask.textContent = 'transcribiendo…';
      void voice.transcribe(recording.id).then((next) => {
        if (fail(next)) {
          ask.disabled = false;
          ask.textContent = 'transcribir aquí mismo';
          return;
        }
        redraw(next as Recording);
      });
    });
    body.append(ask);
    return;
  }

  // ---- Transcrito: corregir y validar -----------------------------------
  if (recording.stage === 'transcribed') {
    const field = document.createElement('textarea');
    field.className = 'voice-transcript';
    field.value = recording.transcript ?? '';
    field.rows = 8;
    field.setAttribute('aria-label', 'transcripción propuesta');
    body.append(field);

    const hint = document.createElement('p');
    hint.className = 'settings-note';
    hint.textContent =
      'Corrígela hasta que diga lo que dijiste. Una línea en blanco separa un ' +
      'bloque del siguiente. Validar la deja fija: después ya no se corrige.';
    body.append(hint);

    const row = document.createElement('div');
    row.className = 'voice-row';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'voice-action';
    save.textContent = 'guardar corrección';
    save.addEventListener('click', () => {
      void voice.correct(recording.id, field.value).then((next) => {
        if (fail(next)) return;
        handlers.notify('corrección guardada');
        redraw(next as Recording);
      });
    });

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'voice-action primary';
    confirm.textContent = 'dice lo que dije';
    confirm.addEventListener('click', () => {
      void voice.correct(recording.id, field.value).then(async (saved) => {
        if (fail(saved)) return;
        const next = await voice.validate(recording.id);
        if (fail(next)) return;
        redraw(next as Recording);
      });
    });

    row.append(save, confirm);
    body.append(row);
    return;
  }

  // ---- Validado: asentar en la página -----------------------------------
  if (recording.stage === 'transcript_validated') {
    const text = document.createElement('pre');
    text.className = 'voice-settled';
    text.textContent = recording.transcript ?? '';
    body.append(text);

    const page = handlers.page();
    const settle = document.createElement('button');
    settle.type = 'button';
    settle.className = 'voice-action primary';
    settle.textContent = page === null ? 'abre una página para asentarlo' : `asentar en «${page.title}»`;
    settle.disabled = page === null;
    settle.addEventListener('click', () => {
      if (page === null) return;
      settle.disabled = true;
      void voice.settle(recording.id, page.id).then((next) => {
        if (fail(next)) {
          settle.disabled = false;
          return;
        }
        const done = next as { recording: Recording; blocks: string[] };
        handlers.onSettled(done.blocks);
        redraw(done.recording);
      });
    });
    body.append(settle);
    return;
  }

  // ---- Asentado ---------------------------------------------------------
  const done = document.createElement('p');
  done.className = 'settings-note';
  done.textContent =
    'El contenido ya vive en la página, y cada bloque nombra esta grabación. ' +
    'Lo que le hagas después —partirlo, editarlo, moverlo— no le quita el origen.';
  body.append(done);

  const another = document.createElement('button');
  another.type = 'button';
  another.className = 'voice-action';
  another.textContent = '● grabar otra';
  another.addEventListener('click', () => redraw(null));
  body.append(another);
}
