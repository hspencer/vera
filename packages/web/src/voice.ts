// Insertar voz: la cascada, del lado de quien habla.
//
// Grabar → transcribir → corregir → validar → asentar. Cada paso es visible y
// cada uno lo confirma una persona. La interfaz no puede saltarse ninguno,
// porque el servidor tampoco la dejaría: el orden lo impone el dominio.
//
// @invariant EveryLinkIsHumanlyConfirmed: la máquina propone la transcripción;
// declarar que dice lo que se dijo es de quien habló.

export type CascadeStage =
  | 'captured'
  | 'transcribed'
  | 'transcript_validated'
  | 'content_settled';

export interface Recording {
  id: string;
  audioHash: string | null;
  mediaType: string;
  durationMs: number | null;
  stage: CascadeStage;
  transcript: string | null;
  evidence: { reference: string; capturedAt: number };
  capturedBy: string;
  capturedAt: number;
  validatedBy: string | null;
  validatedAt: number | null;
}

/** Qué se puede decir de cada etapa, en el orden en que se recorren. */
export const STAGES: { id: CascadeStage; label: string; what: string }[] = [
  { id: 'captured', label: 'grabado', what: 'el audio está guardado' },
  { id: 'transcribed', label: 'transcrito', what: 'la máquina propuso un texto' },
  { id: 'transcript_validated', label: 'transcripción validada', what: 'dice lo que se dijo' },
  { id: 'content_settled', label: 'contenido asentado', what: 'ya vive en la página' },
];

export interface VoiceHandlers {
  page(): string;
  onSettled(blocks: string[]): void;
  notify(message: string): void;
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
  /** Sube el audio. Nace `captured`: nada se transcribe sin pedirlo. */
  capture: (audio: Blob, durationMs: number) =>
    ask<Recording>('/recordings', {
      method: 'POST',
      headers: {
        'content-type': audio.type || 'audio/webm',
        'x-duration-ms': String(Math.round(durationMs)),
      },
      body: audio,
    }),

  transcribe: (id: string) =>
    ask<Recording>(`/recordings/${encodeURIComponent(id)}/transcribe`, { method: 'POST' }),

  correct: (id: string, text: string) =>
    ask<Recording>(`/recordings/${encodeURIComponent(id)}/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),

  validate: (id: string) =>
    ask<Recording>(`/recordings/${encodeURIComponent(id)}/validate`, { method: 'POST' }),

  settle: (id: string, page: string) =>
    ask<{ recording: Recording; blocks: string[] }>(
      `/recordings/${encodeURIComponent(id)}/settle`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page }),
      },
    ),

  list: () => ask<Recording[]>('/recordings'),
};

/** La URL del audio, para poder oírlo mientras se corrige lo que dice. */
export function audioUrl(recording: Recording): string | null {
  return recording.audioHash === null ? null : `/media/${recording.audioHash}`;
}
