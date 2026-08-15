// Transcripción local con whisper.cpp.
//
// Corre en esta máquina y nada sale de ella: una memoria personal soberana no
// manda su voz a un servicio ajeno para saber qué dijo.
//
// @invariant EveryLinkIsHumanlyConfirmed: esto sólo PROPONE. Deja la grabación
// en `transcribed`, nunca en validada. Declarar que el texto dice lo que se dijo
// es un acto de una persona, y ninguna máquina puede hacerlo en su nombre.

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
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
  /** El conversor a wav. */
  ffmpeg?: string;
}

const home = homedir();

const DEFAULTS = {
  language: 'es',
  timeoutMs: 10 * 60 * 1000,
  /*
   * `small` cuesta más CPU que `base`, pero mejora bastante nombres propios,
   * frases largas y puntuación en español. En Vera la voz se transcribe de
   * forma explícita y fuera del gesto de grabar, así que aquí manda la calidad;
   * el tiempo se hace visible en la interfaz y no bloquea seguir leyendo.
   */
  model: `${home}/.local/share/whisper/ggml-small.bin`,
};

// El servidor no siempre nace de un shell de inicio de sesión: un lanzador de
// escritorio o un servicio systemd le entregan un PATH mínimo, sin los binarios
// que uno instaló en su propia casa. Buscar aquí también evita que la voz
// dependa de cómo se arrancó el proceso.
const EXTRA_DIRS = [
  join(home, '.local', 'bin'),
  join(home, 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/home/linuxbrew/.linuxbrew/bin',
];

// whisper.cpp cambió de nombre entre versiones: `main` en las viejas,
// `whisper-cli` en las nuevas.
const WHISPER_NAMES = ['whisper-cli', 'whisper-cpp', 'whisper', 'main'];

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encuentra un binario por nombre, mirando el PATH heredado y además los
 * lugares donde una instalación personal suele dejarlo.
 */
export function findTool(names: string[], override?: string): string | null {
  if (override !== undefined && override !== '') {
    if (isAbsolute(override)) return executable(override) ? override : null;
    names = [override, ...names];
  }
  const dirs = [...(process.env['PATH'] ?? '').split(delimiter).filter((d) => d !== ''), ...EXTRA_DIRS];
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (executable(candidate)) return candidate;
    }
  }
  return null;
}

function whyFailed(error: unknown): string {
  if (error instanceof Error) {
    // execFile cuelga la salida de error del proceso en el error mismo; ahí está
    // el motivo real, y callarlo deja a quien graba sin nada que hacer.
    const stderr = String((error as { stderr?: unknown }).stderr ?? '').trim();
    if (stderr !== '') {
      const lines = stderr.split('\n').filter((line) => line.trim() !== '');
      return lines.slice(-3).join('; ');
    }
    return error.message;
  }
  return 'error desconocido';
}

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
  const language = options.language ?? process.env['VERA_WHISPER_LANGUAGE'] ?? DEFAULTS.language;
  const timeout = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const model = options.model ?? process.env['VERA_WHISPER_MODEL'] ?? DEFAULTS.model;

  const ffmpeg = findTool(['ffmpeg'], options.ffmpeg ?? process.env['VERA_FFMPEG']);
  if (ffmpeg === null) {
    return { error: 'no encuentro ffmpeg; instálalo o apunta VERA_FFMPEG al binario' };
  }
  const command = findTool(WHISPER_NAMES, options.command ?? process.env['VERA_WHISPER']);
  if (command === null) {
    return {
      error: `no encuentro whisper.cpp (${WHISPER_NAMES.join(', ')}); instálalo o apunta VERA_WHISPER al binario`,
    };
  }
  try {
    await readFile(model);
  } catch {
    return { error: `falta el modelo de whisper en ${model}; apunta VERA_WHISPER_MODEL a uno` };
  }

  let work: string | null = null;
  try {
    work = await mkdtemp(join(tmpdir(), 'vera-voz-'));
    const source = join(work, 'origen');
    const wav = join(work, 'audio.wav');
    await writeFile(source, audio);

    try {
      await run(ffmpeg, ['-i', source, '-ar', '16000', '-ac', '1', '-y', wav], { timeout });
    } catch (error) {
      return { error: `no se pudo convertir el audio: ${whyFailed(error)}` };
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
      return { error: `whisper no pudo transcribir: ${whyFailed(error)}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'error desconocido' };
  } finally {
    if (work !== null) await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * ¿Están las herramientas? Se dice al arrancar, no cuando alguien graba: quien
 * levanta el servidor puede arreglarlo antes de que alguien confíe su voz.
 */
export async function transcriberDiagnosis(
  options: TranscriberOptions = {},
): Promise<{ ready: boolean; ffmpeg: string | null; whisper: string | null; model: string | null }> {
  const model = options.model ?? process.env['VERA_WHISPER_MODEL'] ?? DEFAULTS.model;
  const ffmpeg = findTool(['ffmpeg'], options.ffmpeg ?? process.env['VERA_FFMPEG']);
  const whisper = findTool(WHISPER_NAMES, options.command ?? process.env['VERA_WHISPER']);
  let present = true;
  try {
    await readFile(model);
  } catch {
    present = false;
  }
  return {
    ready: ffmpeg !== null && whisper !== null && present,
    ffmpeg,
    whisper,
    model: present ? model : null,
  };
}
