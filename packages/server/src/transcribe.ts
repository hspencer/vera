// Transcripción local con whisper.cpp.
//
// Corre en esta máquina y nada sale de ella: una memoria personal soberana no
// manda su voz a un servicio ajeno para saber qué dijo.
//
// @invariant EveryLinkIsHumanlyConfirmed: esto sólo PROPONE. Deja la grabación
// en `transcribed`, nunca en validada. Declarar que el texto dice lo que se dijo
// es un acto de una persona, y ninguna máquina puede hacerlo en su nombre.

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface TranscriberOptions {
  /** El binario de whisper.cpp. */
  command?: string;
  /** El modelo, que decide la calidad y el tiempo. */
  model?: string;
  language?: string;
  /** Tope de espera: una grabación larga no puede colgar una petición. */
  timeoutMs?: number;
}

const DEFAULTS = {
  command: 'whisper-cli',
  model: `${process.env['HOME'] ?? ''}/.local/share/whisper/ggml-base.bin`,
  language: 'es',
  timeoutMs: 10 * 60 * 1000,
};

export type Transcription = { text: string } | { error: string };

/**
 * Transcribe un audio.
 *
 * whisper.cpp sólo lee wav, flac, mp3 y ogg, y el navegador graba en webm, así
 * que ffmpeg convierte antes a wav mono de 16 kHz, que es lo que el modelo
 * espera. La conversión es de trabajo y va a un temporal: el original no se
 * toca, porque es la cabeza de la cadena.
 */
export async function transcribeAudio(
  audio: Uint8Array,
  options: TranscriberOptions = {},
): Promise<Transcription> {
  const command = options.command ?? DEFAULTS.command;
  const model = options.model ?? DEFAULTS.model;
  const language = options.language ?? DEFAULTS.language;
  const timeout = options.timeoutMs ?? DEFAULTS.timeoutMs;

  let work: string | null = null;
  try {
    work = await mkdtemp(join(tmpdir(), 'vera-voz-'));
    const source = join(work, 'origen');
    const wav = join(work, 'audio.wav');
    await writeFile(source, audio);

    try {
      await run('ffmpeg', ['-i', source, '-ar', '16000', '-ac', '1', '-y', wav], { timeout });
    } catch {
      return { error: 'no se pudo convertir el audio; ¿está ffmpeg disponible?' };
    }

    try {
      // `-nt` quita las marcas de tiempo y `-np` el progreso: lo que sale por
      // la salida estándar es el texto y nada más.
      const { stdout } = await run(
        command,
        ['-m', model, '-l', language, '-nt', '-np', wav],
        { timeout, maxBuffer: 32 * 1024 * 1024 },
      );
      const text = stdout.trim();
      return text === '' ? { error: 'la transcripción salió vacía' } : { text };
    } catch (error) {
      const why = error instanceof Error ? error.message : 'error desconocido';
      return { error: `whisper no pudo transcribir: ${why}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'error desconocido' };
  } finally {
    if (work !== null) await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** ¿Están las herramientas? Se dice al arrancar, no cuando alguien graba. */
export async function transcriberAvailable(options: TranscriberOptions = {}): Promise<boolean> {
  const command = options.command ?? DEFAULTS.command;
  const model = options.model ?? DEFAULTS.model;
  try {
    await run('ffmpeg', ['-version'], { timeout: 5000 });
    await run(command, ['--help'], { timeout: 5000 });
    await readFile(model);
    return true;
  } catch {
    return false;
  }
}
