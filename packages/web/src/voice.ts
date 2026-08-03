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

  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream);
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();
  const began = Date.now();

  const close = (): void => {
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise((done) => {
        recorder.addEventListener('stop', () => {
          close();
          done({
            audio: new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
            durationMs: Date.now() - began,
          });
        });
        recorder.stop();
      }),
    cancel: () => {
      // Cancelar no sube nada: una grabación descartada nunca existió.
      try {
        recorder.stop();
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
