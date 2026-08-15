#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// La puerta MCP de Vera, por entrada y salida estándar.
//
// Un proceso por cliente, lanzado por el cliente, hablando por tuberías. Sin
// puerto, sin red y sin nada escuchando: mientras la puerta sea ésta, el
// problema de exponer la memoria de alguien a internet no existe todavía. Es a
// propósito, y es la primera etapa de las seis que la página del corpus fija.
//
// Se usa el SDK oficial y no una implementación a mano de JSON-RPC. La razón es
// que el ecosistema está a medio migrar —hay clientes en 2025-06-18, en
// 2025-11-25 y en 2026-07-28— y negociar versión es exactamente el trabajo que
// no conviene mantener dos veces.
//
// Con esto se conectan hoy Claude Code, Claude Desktop, Codex y Gemini CLI, que
// hablan MCP por stdio. Lo que necesita servidor remoto son las versiones web, y
// eso es M5 y M6.
//
// Ver specs/mcp-server.allium.

import { readFileSync } from 'node:fs';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ask as askVera, connectionFrom, submit as submitVera, type Connection } from './client.ts';
import { TOOLS, toolNamed, type Ask, type Write } from './tools.ts';

const VERSION = '0.3.0';

/**
 * Lo que un cliente lee antes de decidir cómo usar esto.
 *
 * Dice qué es la memoria y dice qué no puede hacerse con ella. La segunda mitad
 * importa tanto como la primera: un modelo al que no se le dice que la puerta es
 * de lectura pasa el turno intentando escribir y termina proponiéndole al
 * usuario que copie y pegue.
 */
const INSTRUCTIONS = `Vera es la memoria personal de quien te conectó: un corpus de páginas y bloques
con procedencia, escrito a lo largo de años. No es una base de conocimiento
genérica ni un buscador: es lo que esta persona pensó, anotó y decidió.

Cómo leerla:
- Empieza por vera_quien_soy para comprobar la conexión.
- Si no sabes dónde está algo, vera_buscar. Los extractos traen la página y el
  bloque de donde salieron: cítalos por su título.
- Para el texto completo, vera_leer_pagina con el título que salió en la
  búsqueda.
- vera_ontologia dice cómo está clasificado este corpus. El vocabulario lo puso
  el dueño; no supongas el significado de una propiedad sin mirarlo.

Al escribir:
- Lee primero la página o busca el bloque que vas a tocar.
- Usa vera_escribir para un solo cambio por llamada y conserva su clave \`origen\`
  al reintentar. Cada cambio nuevo necesita otra clave.
- Esta primera superficie crea páginas y bloques. No edita, mueve ni borra:
  Vera aún no tiene la precondición atómica necesaria para editar sin pisar.
- Parte del corpus lo escribieron otras inteligencias. vera_leer_pagina lo dice.
  No presentes como recuerdo de esta persona algo que generó una máquina.
- Todo lo que leas queda anotado en el registro de exposición del dueño: qué
  páginas viajaron, hacia qué cliente y cuándo.`;

async function main(): Promise<void> {
  const connection: Connection = connectionFrom(process.env, (path) =>
    readFileSync(path, 'utf8'),
  );

  const ask: Ask = (path, parameters) => askVera(connection, path, parameters);
  const write: Write = (origin, change) => submitVera(connection, origin, change);

  const server = new Server(
    { name: 'vera', version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: tool.readOnly !== false,
        destructiveHint: false,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = toolNamed(request.params.name);
    if (tool === undefined) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Vera no tiene una herramienta «${request.params.name}».` }],
      };
    }
    /*
     * Un fallo se contesta como resultado y no como excepción del protocolo.
     *
     * Un error de protocolo corta el turno del modelo; un resultado con
     * `isError` le llega como texto y puede corregir —pedir otra página, buscar
     * primero—. Vera apagada es una circunstancia, no una violación.
     */
    try {
      const text = await tool.run(request.params.arguments ?? {}, ask, write);
      return { content: [{ type: 'text' as const, text }] };
    } catch (trouble) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Vera falló al contestar: ${String(trouble)}` }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}

/*
 * Nada de esto puede escribir en la salida estándar: ahí va el protocolo, y un
 * `console.log` suelto rompe la conversación con un JSON-RPC inválido. Los avisos
 * van a la de errores, que el cliente recoge en su registro.
 */
main().catch((trouble: unknown) => {
  process.stderr.write(`vera-mcp no pudo arrancar: ${String(trouble)}\n`);
  process.exit(1);
});
