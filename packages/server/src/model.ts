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
import { titleKey } from '@vera/core';
import {
  describeCandidates,
  describeOntology,
  type OntologyContext,
} from './ontology-context.ts';

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

    /*
     * Y aun así se limpia lo que el programa pone alrededor.
     *
     * Delante viene su rótulo —el logo, la versión, el menú de comandos— y el
     * prompt repetido; detrás, la línea de estadísticas. Nada de eso es del
     * modelo. Confiar en una bandera para que la salida sea sólo la respuesta es
     * confiar en algo que ya falló: `-no-cnv` no evita el rótulo en las
     * versiones nuevas, y `--log-disable` tampoco.
     *
     * Y el eco no siempre se puede buscar entero, porque llama-cli lo corta él
     * mismo por la mitad y escribe «... (truncated)» donde cortó. De ahí los
     * tres intentos, del más exacto al más tolerante: el prompt entero, la marca
     * de truncado, y la última línea del prompt. Lo que no se sepa recortar se
     * devuelve tal cual y lo rechazará quien lo lea, que es mejor que devolver
     * medio rótulo creyendo que es una respuesta.
     */
    let text = stdout;
    const echoed = text.lastIndexOf(prompt);
    const cut = text.lastIndexOf('(truncated)');
    const tail = prompt
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .at(-1);
    const near = tail === undefined ? -1 : text.lastIndexOf(tail);
    if (echoed !== -1) text = text.slice(echoed + prompt.length);
    else if (cut !== -1) text = text.slice(cut + '(truncated)'.length);
    else if (near !== -1 && tail !== undefined) text = text.slice(near + tail.length);
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
  /** IDs de páginas que Vera ofreció y el modelo eligió. */
  existingConcepts: string[];
  /** Nombres que no corresponden a ninguno de los candidatos ofrecidos. */
  newConcepts: string[];
}

/**
 * Cuánto texto se le da al modelo de una vez.
 *
 * Es el límite del modelo y no el de la página: con `-c 4096` de contexto, tres
 * mil caracteres y el prompt caben, y el doble no. Lo que no cabe de una vez se
 * lee en varias —ver `readingPasses` en structure.ts—, que es lo que separa un
 * límite de contexto de un recorte.
 */
export const READABLE_CHARS = 3000;

/**
 * Cuántas veces como mucho se le pregunta al modelo por una misma página.
 *
 * Cada pase es un proceso de llama.cpp que tarda segundos en esta máquina, así
 * que una transcripción de dos horas leída entera dejaría a alguien mirando la
 * pantalla un cuarto de hora. Se leen ocho —unos veinticuatro mil caracteres, ya
 * ocho veces más que antes— y lo que quede fuera se dice.
 */
export const MOST_PASSES = 8;

/**
 * Presupuesto conservador para una ventana de 4.096 tokens.
 *
 * Los caracteres no son tokens, pero en castellano 8.500 deja holgura para la
 * respuesta, el template interno de Qwen y palabras que se parten en varias
 * piezas. Antes se presupuestaba sólo el texto de la página: ontología y 24
 * candidatos podían empujar el prompt completo fuera de la ventana.
 */
export const READING_PROMPT_CHARS = 8_500;

/** Arma el prompt completo y hace caber contexto, evidencia y texto juntos. */
export function readingPrompt(
  title: string,
  text: string,
  vocabulary: readonly string[],
  context: OntologyContext,
): string {
  let extract = text.replace(/\s+/g, ' ').slice(0, READABLE_CHARS);
  let candidates = [...context.candidates];
  const compose = (): string => `Eres un bibliotecario que clasifica páginas de una memoria personal.

${describeOntology(context)}

Vocabulario de tipos permitido: ${vocabulary.join(', ')}.

CONCEPTOS EXISTENTES RECUPERADOS POR VERA:
${describeCandidates(candidates)}

Responde SÓLO con JSON, sin explicar nada, con esta forma exacta:
{"types": ["…"], "existingConcepts": ["page:…"], "newConcepts": ["…"]}

- "types": normalmente un tipo. Devuelve dos sólo si la PÁGINA misma es
  intrínsecamente ambas cosas, no porque su texto mencione personas, lugares o eventos.
- "existingConcepts": IDs copiados EXACTAMENTE de la lista recuperada. Elige sólo
  conceptos de los que la página trata realmente; una mera mención no basta.
- "newConcepts": temas necesarios que no equivalen a ningún candidato recuperado.
  Son asuntos durables que ayudarían a recuperar otras páginas relacionadas, no
  tipos, fechas, cantidades, audiencias, cargos ni nombres propios incidentales.
  En minúsculas.
- Entre existentes y nuevos devuelve como máximo cinco. Si dudas, devuelve menos.

Página: «${title}»
Texto: ${extract}`;

  // Primero se quita el candidato menos pertinente: `relevantConcepts` ya los
  // entregó ordenados. El texto del pase se recorta sólo si la ontología y los
  // candidatos verdaderamente pertinentes todavía no caben.
  while (candidates.length > 0 && compose().length > READING_PROMPT_CHARS) candidates.pop();
  const overflow = compose().length - READING_PROMPT_CHARS;
  if (overflow > 0) extract = extract.slice(0, Math.max(0, extract.length - overflow));
  return compose();
}

/**
 * Lee una página y propone qué es y de qué trata.
 *
 * Dos preguntas y no una, porque son dos: qué clase de cosa es algo y sobre qué
 * habla se responden por separado o no se responden bien. @guarantee
 * TypeAndTopicAreNeverTheSameQuestion.
 *
 * Lee de una vez lo que le quepa de una vez: quien llama le entrega un pase, no
 * la página entera. Leerla entera es repartirla antes y juntar después —ver
 * `readingPasses` y `mergeReadings`—, porque darle diez mil palabras a un modelo
 * de 3B no es leer más, es leer peor.
 */
export async function readPage(
  title: string,
  text: string,
  vocabulary: string[] = STARTER_TYPES,
  context: OntologyContext = { objects: [], properties: [], candidates: [] },
): Promise<Reading | { error: string }> {
  const answer = await ask(
    readingPrompt(title, text, vocabulary, context),
    { maxTokens: 300 },
  );

  if ('error' in answer) return answer;

  const parsed = lastObjectIn(answer.text);
  if (parsed === null) return { error: 'el modelo no respondió en el formato pedido' };

  return readingFrom(parsed, vocabulary, context);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    : [];

/**
 * Ata la salida probabilística a identidades verificables.
 *
 * Qwen 3B a veces comprende un candidato y, aun así, copia su título en
 * `newConcepts` en vez de su ID. Una coincidencia exacta normalizada no es una
 * inferencia: es la misma identidad escrita de otra forma, y Vera puede
 * reconciliarla sin pedirle otra llamada al modelo. No se hace fuzzy matching;
 * dos conceptos parecidos siguen siendo dos hasta que una persona los una.
 */
export function readingFrom(
  parsed: {
    types?: unknown;
    concepts?: unknown;
    existingConcepts?: unknown;
    newConcepts?: unknown;
  },
  vocabulary: readonly string[],
  context: OntologyContext,
): Reading {
  const byId = new Map(context.candidates.map((candidate) => [candidate.id, candidate]));
  const byTitle = new Map(context.candidates.map((candidate) => [titleKey(candidate.title), candidate]));
  const existing: string[] = [];
  const fresh: string[] = [];
  const hold = (id: string): void => {
    if (!existing.includes(id)) existing.push(id);
  };

  for (const said of strings(parsed.existingConcepts)) {
    const candidate = byId.get(said.trim()) ?? byTitle.get(titleKey(said));
    if (candidate !== undefined) hold(candidate.id);
  }
  for (const said of strings(parsed.newConcepts ?? parsed.concepts)) {
    const candidate = byTitle.get(titleKey(said));
    if (candidate !== undefined) hold(candidate.id);
    else if (!fresh.some((one) => titleKey(one) === titleKey(said))) fresh.push(said.trim());
  }

  const types = strings(parsed.types)
    .flatMap((said) => {
      const canonical = vocabulary.find((word) => titleKey(word) === titleKey(said));
      return canonical === undefined ? [] : [canonical];
    })
    .filter((type, index, all) => all.indexOf(type) === index)
    .slice(0, 2);
  const concepts = [
    ...existing.map((id) => ({ existing: id })),
    ...fresh.map((name) => ({ fresh: name })),
  ].slice(0, 5);
  return {
    types,
    existingConcepts: concepts.flatMap((one) => 'existing' in one ? [one.existing] : []),
    newConcepts: concepts.flatMap((one) => 'fresh' in one ? [one.fresh] : []),
  };
}

/**
 * Junta lo que dijo cada pase en una sola lectura de la página.
 *
 * Se cuenta: lo que varias partes de una página dicen que es, es más
 * probablemente lo que la página es, y lo que dijo una sola parte suele ser de
 * esa parte y no del documento. A igualdad de menciones manda el orden de
 * aparición, porque una página empieza diciendo de qué va.
 *
 * No se inventa nada que ningún pase dijera, y los topes son los mismos que los
 * de una lectura sola —dos tipos, cinco conceptos—: leer la página entera da una
 * lectura mejor, no una lista más larga.
 */
export function mergeReadings(readings: Reading[]): Reading {
  const vote = (lists: string[][], most: number): string[] => {
    const seen = new Map<string, { label: string; count: number; first: number }>();
    let at = 0;
    for (const list of lists) {
      for (const word of list) {
        at += 1;
        const key = word.trim().toLowerCase();
        if (key === '') continue;
        const already = seen.get(key);
        if (already === undefined) seen.set(key, { label: word.trim(), count: 1, first: at });
        else already.count += 1;
      }
    }
    return [...seen.values()]
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .slice(0, most)
      .map((one) => one.label);
  };

  const concepts = vote(
    readings.map((reading) => [
      ...reading.existingConcepts.map((id) => `existing:${id.trim()}`),
      ...reading.newConcepts.map((name) => `new:${name.trim()}`),
    ]),
    5,
  );
  return {
    types: vote(
      readings.map((reading) => reading.types),
      2,
    ),
    existingConcepts: concepts
      .filter((concept) => concept.startsWith('existing:'))
      .map((concept) => concept.slice('existing:'.length)),
    newConcepts: concepts
      .filter((concept) => concept.startsWith('new:'))
      .map((concept) => concept.slice('new:'.length)),
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
export function lastObjectIn(text: string): {
  types?: unknown;
  concepts?: unknown;
  existingConcepts?: unknown;
  newConcepts?: unknown;
} | null {
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
            if (
              'types' in parsed ||
              'concepts' in parsed ||
              'existingConcepts' in parsed ||
              'newConcepts' in parsed
            ) return parsed;
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
