// El modelo local que lee una página.
//
// Corre en esta máquina, como el que transcribe la voz. @invariant
// TheModelIsLocalOrThereIsNone, de controlled-ontology.allium: un corpus no sale
// de casa para ser entendido, y donde no haya modelo se hace la parte que no lo
// necesita y se dice cuál no se pudo.
//
// llama.cpp y no otro: es el hermano del whisper.cpp que Vera ya usa, se instala
// igual y en el mismo sitio. El contrato es un binario y un archivo GGUF, así que
// cambiar de modelo es cambiar una ruta, y cambiar de motor —a Ollama, a lo que
// venga— es escribir otro módulo con esta misma forma.

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { findTool } from './transcribe.ts';

const run = promisify(execFile);
const home = homedir();

const DEFAULT_MODEL = join(home, '.local', 'share', 'llama', 'qwen2.5-3b-instruct-q4_k_m.gguf');
const NAMES = ['llama-cli'];

export interface ModelPresence {
  ready: boolean;
  binary: string | null;
  model: string | null;
}

/** ¿Hay con qué leer? Se pregunta antes de prometer nada. */
export async function modelPresence(): Promise<ModelPresence> {
  const binary = findTool(NAMES, process.env['VERA_LLAMA']);
  const model = process.env['VERA_LLAMA_MODEL'] ?? DEFAULT_MODEL;
  let present = true;
  try {
    await access(model);
  } catch {
    present = false;
  }
  return { ready: binary !== null && present, binary, model: present ? model : null };
}

export interface AskOptions {
  /** Tope de espera. Una página larga no puede colgar una petición para siempre. */
  timeoutMs?: number;
  /** Cuántos tokens como mucho. Lo que se pide aquí son respuestas cortas. */
  maxTokens?: number;
}

/**
 * Le hace una pregunta al modelo y devuelve lo que respondió, en crudo.
 *
 * Temperatura cero: se le pide que clasifique, no que invente. La misma página
 * preguntada dos veces debe dar la misma respuesta, o revisar una sugerencia no
 * significaría nada.
 */
export async function ask(
  prompt: string,
  options: AskOptions = {},
): Promise<{ text: string } | { error: string }> {
  const presence = await modelPresence();
  if (!presence.ready || presence.binary === null || presence.model === null) {
    return { error: 'no hay un modelo local instalado' };
  }

  try {
    // El orden importa: con `-p` antes de `-no-cnv`, llama-cli entra igual en
    // modo conversación y devuelve su banner, el menú de comandos y el prompt
    // repetido antes de la respuesta. Las banderas van primero y el texto al
    // final, que es como funciona.
    const { stdout } = await run(
      presence.binary,
      [
        '-m', presence.model,
        '-no-cnv', '-st', '--no-warmup',
        '-t', '8',
        '-c', '4096',
        '-n', String(options.maxTokens ?? 200),
        '--temp', '0',
        '-p', prompt,
      ],
      { timeout: options.timeoutMs ?? 120_000, maxBuffer: 8 * 1024 * 1024 },
    );

    // Y aun así se limpia lo que el programa pone alrededor: la línea de
    // estadísticas al final es suya, no del modelo, y el prompt viene repetido
    // al principio. Confiar en una bandera para que la salida sea sólo la
    // respuesta es confiar en algo que ya falló una vez.
    let text = stdout;
    const echoed = text.lastIndexOf(prompt);
    if (echoed !== -1) text = text.slice(echoed + prompt.length);
    text = text.split(/\n\[ Prompt:/)[0] ?? '';
    text = text.replace(/\n?Exiting\.\.\.\s*$/, '').trim();
    return text === '' ? { error: 'el modelo no respondió nada' } : { text };
  } catch (error) {
    const why = error instanceof Error ? error.message : 'error desconocido';
    return { error: `el modelo no pudo leer la página: ${why}` };
  }
}

/**
 * El vocabulario con el que se clasifica.
 *
 * Vive aquí como valor por defecto y no como verdad: la página especial de
 * ontología lo pisa cuando existe. @invariant DefaultsLiveInTheCode.
 */
export const STARTER_TYPES = [
  'Persona',
  'Organización',
  'Lugar',
  'Idea',
  'Pregunta',
  'Afirmación',
  'Nota',
  'Proyecto',
  'Tarea',
  'Trámite',
  'Entrada diaria',
  'Bitácora',
  'Evento',
  'Publicación',
  'Borrador de publicación',
  'Fuente',
];

export interface Reading {
  types: string[];
  concepts: string[];
}

/**
 * Lee una página y propone qué es y de qué trata.
 *
 * Dos preguntas y no una, porque son dos: qué clase de cosa es algo y sobre qué
 * habla se responden por separado o no se responden bien. @guarantee
 * TypeAndTopicAreNeverTheSameQuestion.
 *
 * Se le da poco texto a propósito: las primeras líneas de una página dicen de
 * qué va, y darle diez mil palabras a un modelo de 3B lo empeora además de
 * volverlo lento.
 */
export async function readPage(
  title: string,
  text: string,
  vocabulary: string[] = STARTER_TYPES,
): Promise<Reading | { error: string }> {
  const extract = text.replace(/\s+/g, ' ').slice(0, 3000);

  const answer = await ask(
    `Eres un bibliotecario que clasifica páginas de una memoria personal.

Vocabulario de tipos permitido: ${vocabulary.join(', ')}.

Responde SÓLO con JSON, sin explicar nada, con esta forma exacta:
{"types": ["…"], "concepts": ["…"]}

- "types": uno o dos tipos del vocabulario. Qué CLASE DE COSA es la página.
- "concepts": entre dos y cinco temas de los que la página TRATA, en minúsculas.
  No son tipos: son asuntos. Si no estás seguro, pon menos.

Página: «${title}»
Texto: ${extract}`,
    { maxTokens: 200 },
  );

  if ('error' in answer) return answer;

  const parsed = lastObjectIn(answer.text);
  if (parsed === null) return { error: 'el modelo no respondió en el formato pedido' };

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
  return {
    // Lo que no está en el vocabulario se descarta: el modelo propone dentro de
    // lo que hay, y una palabra inventada sería vocabulario nuevo entrando por
    // la puerta de atrás.
    types: strings(parsed.types).filter((t) =>
      vocabulary.some((v) => v.toLowerCase() === t.toLowerCase()),
    ),
    concepts: strings(parsed.concepts).slice(0, 5),
  };
}

/**
 * El último objeto JSON que hay en un texto.
 *
 * El modelo suele envolver su respuesta en explicaciones o en vallas de código
 * aunque se le pida que no, así que se busca el objeto en vez de exigir
 * obediencia. Del final hacia atrás y contando llaves, no con una expresión
 * codiciosa: el propio prompt lleva un `{…}` de ejemplo, y `\{[\s\S]*\}` abarcaba
 * desde esa llave hasta la última del texto y no parseaba nunca.
 */
export function lastObjectIn(text: string): { types?: unknown; concepts?: unknown } | null {
  let start = text.lastIndexOf('{');
  while (start !== -1) {
    let depth = 0;
    for (let at = start; at < text.length; at += 1) {
      const character = text[at];
      if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, at + 1)) as Record<string, unknown>;
            // Un objeto cualquiera no sirve: tiene que ser el que se pidió.
            if ('types' in parsed || 'concepts' in parsed) return parsed;
          } catch {
            // No era JSON válido; se sigue buscando hacia atrás.
          }
          break;
        }
      }
    }
    // `lastIndexOf` con un índice negativo busca desde 0, así que en la primera
    // llave del texto devolvería 0 para siempre. Se corta aquí.
    if (start === 0) break;
    start = text.lastIndexOf('{', start - 1);
  }
  return null;
}
