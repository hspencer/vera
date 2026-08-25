# vera-mcp

La puerta MCP de Vera. Un proceso por cliente, lanzado por el cliente, hablando
por entrada y salida estándar. Sin puerto propio ni nada escuchando. La
[explicación pública](https://vera.mediafranca.net/vera-puerta-mcp/) vive en
Vera; aquí queda el contrato operativo del paquete.

La puerta ofrece lectura y escritura no destructiva. Cada lectura queda en el
registro de exposición y cada escritura pasa por `POST /operations`, con la
identidad y los alcances de la credencial.

## Qué ofrece

| Herramienta | Qué hace |
| --- | --- |
| `vera_quien_soy` | Comprueba la conexión, la identidad y los alcances. La primera llamada. |
| `vera_buscar` | Extractos de todo el corpus, con la página y el bloque de donde salieron. |
| `vera_leer_pagina` | Una página entera, con su sangría, sus propiedades y su vecindad. |
| `vera_historia_bloque` | Todo lo que un bloque dijo alguna vez, incluido lo borrado. |
| `vera_vecindario` | El mapa alrededor de una página. |
| `vera_indice` | Los títulos del corpus. |
| `vera_preparar_escritura` | Lee juntas las reglas vivas para agentes y la ontología antes de escribir. |
| `vera_escribir` | Crea páginas o bloques y gestiona propiedades mediante una operación atribuida e idempotente. |
| `vera_ontologia` | Cómo está clasificada esta memoria. |

## Cómo se conecta cada cliente

La guía completa —el método general, válido para cualquier proveedor, con la
tabla de qué pide cada formulario y qué hacer cuando falla— está en
[docs/conectar-una-ia.md](../../docs/conectar-una-ia.md). Aquí quedan las cuatro
recetas de siempre.

Vera tiene que estar corriendo (`npm run serve`, por omisión en el 4173).

**Claude Code** — ya está: el `.mcp.json` de la raíz del repositorio lo declara.
Al abrir Claude Code aquí, pregunta si se confía en el servidor del proyecto.
Para tenerlo en cualquier directorio y no sólo en éste:

```sh
claude mcp add vera --scope user -- \
  node --experimental-strip-types --no-warnings \
  /home/hspencer/Sites/vera/packages/mcp/src/main.ts
```

**Claude Desktop** — en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vera": {
      "command": "node",
      "args": ["--experimental-strip-types", "--no-warnings",
               "/home/hspencer/Sites/vera/packages/mcp/src/main.ts"],
      "env": { "VERA_URL": "http://127.0.0.1:4173", "VERA_CLIENT": "claude-desktop" }
    }
  }
}
```

**Codex** — en `~/.codex/config.toml`:

```toml
[mcp_servers.vera]
command = "node"
args = ["--experimental-strip-types", "--no-warnings",
        "/home/hspencer/Sites/vera/packages/mcp/src/main.ts"]
env = { VERA_URL = "http://127.0.0.1:4173", VERA_CLIENT = "codex" }
```

**Gemini CLI** — en `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vera": {
      "command": "node",
      "args": ["--experimental-strip-types", "--no-warnings",
               "/home/hspencer/Sites/vera/packages/mcp/src/main.ts"],
      "env": { "VERA_URL": "http://127.0.0.1:4173", "VERA_CLIENT": "gemini" }
    }
  }
}
```

Los servicios alojados por el proveedor —incluido ChatGPT— no pueden conectarse
por aquí: necesitan una puerta MCP Streamable HTTP públicamente alcanzable por
HTTPS y estrictamente autenticada. Esa superficie aislada es M5; OAuth para los
clientes que lo exijan es M6. «Públicamente alcanzable» no significa publicar la
aplicación privada ni permitir lecturas anónimas.

## El entorno

| Variable | Para qué | Por omisión |
| --- | --- | --- |
| `VERA_URL` | Dónde está la API. | `http://127.0.0.1:4173` |
| `VERA_TOKEN_FILE` | Archivo con el secreto de la credencial. | — |
| `VERA_TOKEN` | El secreto, si no hay archivo. | — |
| `VERA_CLIENT` | Cómo se declara el cliente en el registro de exposición. | `vera-mcp` |

La credencial no se pasa nunca por argumentos: los argumentos de un proceso los
lee cualquiera con un `ps`. `VERA_TOKEN_FILE` antes que `VERA_TOKEN`, porque una
variable de entorno se hereda a todo lo que el proceso lance y un archivo con
permisos no.

Sin credencial se entra como el dueño, que es lo que hoy es cierto en casa. El
registro de exposición lo anota como lo que es —una lectura sin credencial— en
vez de disimular la ausencia.

## Lo que queda anotado

Cada lectura escribe una fila en el registro de exposición de Vera: quién,
con qué credencial, qué cliente dijo ser, qué se entregó y cuánto medía. Se
mira en `GET /exposures`, y al revés —quién ha leído esto— en
`GET /exposures?subject=page:1234`.
