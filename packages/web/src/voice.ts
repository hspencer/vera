// La voz, del lado de quien habla.
//
// Tres cosas: grabar, transcribir —cuantas veces se quiera— y borrar el audio.
// El texto que la transcripción deja es el del bloque, y se edita como cualquier
// otro. No hay estado que avanzar ni paso que completar.
//
// @invariant TheMachineNeverPassesForAHand: la transcripción llega escrita por
// la máquina y firmada como tal; deja de estarlo en cuanto alguien la edita.

export interface Recording {
  id: string;
  audioHash: string | null;
  mediaType: string;
  durationMs: number | null;
  /** Lo que la máquina dijo la última vez que se le preguntó. */
  transcript: string | null;
  /** El bloque que le guarda el lugar en la escritura, si se habló dentro de una. */
  placedInBlock: string | null;
  /** La página de ese bloque, para poder llegar a ella sin una petición más. */
  placedInPage: string | null;
  evidence: { reference: string; capturedAt: number };
  capturedBy: string;
  capturedAt: number;
}

/**
 * Graba desde el micrófono.
 *
 * Devuelve una función que detiene y entrega lo grabado. El navegador entrega
 * webm/opus; convertirlo a algo que whisper lea es cosa del servidor, que es
 * donde está ffmpeg.
 */
export async function startRecording(): Promise<{
  stop(): Promise<{ audio: Blob; durationMs: number }>;
  cancel(): void;
} | { error: string }> {
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    return { error: 'este navegador no da acceso al micrófono' };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    // Denegar el micrófono es una respuesta legítima y se dice como tal.
    const why = error instanceof Error && error.name === 'NotAllowedError'
      ? 'no diste permiso para el micrófono'
      : 'no se pudo abrir el micrófono';
    return { error: why };
  }

  /*
   * Se vuelca un trozo por segundo, no uno solo al final.
   *
   * Sin intervalo, `MediaRecorder` acumula la grabación entera y la entrega de
   * una vez al detener. Si el sistema interrumpe la captura antes —y en un
   * teléfono la interrumpe: la pantalla se apaga, la aplicación pasa a segundo
   * plano, otra cosa pide el micrófono— ese único trozo no llega nunca y lo
   * dicho se pierde entero. Volcando por segundo, una interrupción cuesta como
   * mucho el último segundo, que es la diferencia entre una grabación truncada y
   * ninguna grabación.
   */
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start(1000);
  const began = Date.now();

  /*
   * Que la pantalla no se apague mientras se habla.
   *
   * Es la causa y no el síntoma. Dictando, nadie toca la pantalla —para eso se
   * dicta— así que el teléfono se duerme a mitad de frase y con él se va la
   * captura. El bloqueo se pide al empezar y se vuelve a pedir al volver al
   * frente, porque el sistema lo retira al pasar a segundo plano y no lo
   * devuelve solo.
   *
   * Que falle no impide grabar: hay navegadores que no lo tienen, y grabar con
   * riesgo de que se apague la pantalla sigue siendo mejor que no grabar.
   */
  let awake: WakeLockSentinel | null = null;
  const keepAwake = async (): Promise<void> => {
    try {
      awake = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      awake = null;
    }
  };
  const reacquire = (): void => {
    if (document.visibilityState === 'visible' && awake === null) void keepAwake();
  };
  document.addEventListener('visibilitychange', reacquire);
  void keepAwake();

  const close = (): void => {
    document.removeEventListener('visibilitychange', reacquire);
    void awake?.release().catch(() => undefined);
    awake = null;
    for (const track of stream.getTracks()) track.stop();
  };

  const captured = (): { audio: Blob; durationMs: number } => ({
    audio: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
    durationMs: Date.now() - began,
  });

  /*
   * Un solo sitio donde la grabación termina, y termina una sola vez.
   *
   * Antes se escuchaba el final *dentro* de `stop()`, es decir, después de
   * pedirlo. Un final que ocurriera antes —porque el sistema paró la captura
   * mientras la pantalla estaba apagada— no lo oía nadie: al volver y pulsar
   * «detener», la promesa se quedaba esperando un evento que ya había pasado y
   * no volvería, y el botón se quedaba en «guardando…» para siempre con el audio
   * dentro. Ese es el fallo que hacía falta arreglar.
   *
   * Ahora se escucha desde el principio y por las tres vías por las que esto
   * puede acabar: que se pida, que el grabador falle, o que el sistema retire el
   * micrófono. La primera que llegue cierra; las demás no hacen nada.
   */
  let settle: ((result: { audio: Blob; durationMs: number }) => void) | null = null;
  let finished: { audio: Blob; durationMs: number } | null = null;

  const finish = (): void => {
    if (finished !== null) return;
    finished = captured();
    close();
    settle?.(finished);
  };

  recorder.addEventListener('stop', finish);
  // El grabador se rinde: lo grabado hasta aquí es lo que hay, y vale.
  recorder.addEventListener('error', finish);
  // El sistema retiró el micrófono —otra aplicación lo pidió, o se acabó el
  // permiso—. La pista termina sin que el grabador se entere.
  for (const track of stream.getTracks()) track.addEventListener('ended', finish);

  return {
    stop: () =>
      new Promise((done) => {
        if (finished !== null) {
          done(finished);
          return;
        }
        settle = done;
        try {
          // Puede estar ya inactivo si el sistema lo paró: entonces esto lanza,
          // y lo que corresponde es cerrar con lo que haya en vez de esperar un
          // evento que no va a llegar.
          if (recorder.state === 'inactive') finish();
          else recorder.stop();
        } catch {
          finish();
        }
      }),
    cancel: () => {
      // Cancelar no sube nada: una grabación descartada nunca existió.
      finished = captured();
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* ya estaba detenido */
      }
      close();
    },
  };
}

async function ask<T>(path: string, options: RequestInit = {}): Promise<T | { error: string }> {
  try {
    const response = await fetch(path, options);
    const body = (await response.json()) as T | { error: string };
    if (!response.ok) {
      return { error: (body as { error?: string }).error ?? `error ${response.status}` };
    }
    return body;
  } catch {
    return { error: 'sin conexión con el servidor' };
  }
}

export const voice = {
  /**
   * Sube el audio y lo pega a un bloque. Nada se transcribe sin pedirlo.
   */
  capture: (audio: Blob, durationMs: number, inBlock?: string) =>
    ask<Recording>('/recordings', {
      method: 'POST',
      headers: {
        'content-type': audio.type || 'audio/webm',
        'x-duration-ms': String(Math.round(durationMs)),
        ...(inBlock === undefined ? {} : { 'x-in-block': inBlock }),
      },
      body: audio,
    }),

  /**
   * Transcribe y escribe el texto del bloque. Volver a llamarla lo reemplaza y
   * no toca el audio.
   */
  transcribe: (id: string) =>
    ask<{ recording: Recording; block: string; text: string }>(
      `/recordings/${encodeURIComponent(id)}/transcribe`,
      { method: 'POST' },
    ),

  /**
   * Borra el audio. En cualquier momento, transcrito o no: la grabación es de
   * quien la hizo. Lo escrito sigue escrito y sigue nombrando de dónde vino.
   */
  discardAudio: (id: string) =>
    ask<Recording>(`/recordings/${encodeURIComponent(id)}/audio`, { method: 'DELETE' }),

  /** Le da o le quita lugar en la escritura a una grabación. */
  place: (id: string, block: string | null) =>
    ask<Recording>(`/recordings/${encodeURIComponent(id)}/place`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ block }),
    }),

  list: () => ask<Recording[]>('/recordings'),
};

/** La URL del audio, para oírlo desde donde se lee lo que dice. */
export function audioUrl(recording: Recording): string | null {
  return recording.audioHash === null ? null : `/media/${recording.audioHash}`;
}
