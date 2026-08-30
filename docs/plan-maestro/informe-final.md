# Informe final de la auditoría

Estado al escribirlo: 2026-08-30. Auditoría de solo lectura sobre
`worktree-vera-repository-audit` (base `v0.6-federacion`). Cuatro agentes de
lectura, uno por dominio, más lectura directa del corpus de Vera vía MCP.
Ningún archivo de código o spec fue modificado; sólo se crearon los documentos
de este directorio.

## Hechos verificados

Verificado significa: código leído, y un test corrido con `node --test` que
pasó, ejercitando ese código específico. Donde no hay test, se dice
explícitamente.

1. `allium check specs/` corre limpio de errores sobre **38** archivos
   `.allium`, con 21 warnings (entidades/campos/bindings declarados y no
   usados) repartidos en 10 specs.
2. `npm test` da **1298/1298** en verde, en 279 suites, **después de**
   `npm run build`. Sin build previo, falla 1/1298 por dependencia implícita
   de un test de servidor sobre `packages/web/dist`.
3. `npm run typecheck` y `npm run build` corren limpios.
4. El registro canónico de operaciones, la edición optimista, la bandeja de
   salida durable y la retención local de páginas están implementados y
   probados con evidencia archivo:línea (`packages/core/src/graph.ts`,
   `packages/web/src/replica.ts`, `outbox.ts`, `held.ts`).
5. El cálculo de desacuerdo entre versiones de un bloque (diff por líneas)
   está implementado y probado; el diálogo de resolución y su aplicación al
   grafo no tienen ningún test.
6. No existe, en ningún archivo del repositorio, código de restauración
   integral, respaldo, formato portable entre versiones, red horizontal entre
   instancias, identidad federada, sincronización federada, conversación con
   Cotito (`agent-conversation.allium`), ni VeraAgentManifest.
7. Los secretos de conexiones de servicio (por ejemplo, Zotero) se guardan en
   texto plano en SQLite (`packages/store/src/secrets.ts:52-67`).
8. Nueve de diez sitios de escritura en `packages/server/src/server.ts` no
   capturan un fallo de persistencia; uno sí (`:1452-1476`).
9. No hay rate-limiting en ninguna puerta del sistema (API, autenticación
   humana, invitaciones, MCP público), ni límite de tiempo por petición en el
   servidor MCP público.
10. El mecanismo de autenticación humana (WebAuthn) está implementado y
    probado de punta a punta para invitados de espacios compartidos; no existe
    ninguna vía de alta equivalente para el dueño de la instancia.
11. No existe jsdom, happy-dom ni ningún harness de DOM en ningún
    `package.json` del monorepo; varios archivos con nombre de "test de
    interfaz" verifican patrones de texto en el código fuente, no
    comportamiento ejecutado.
12. El arrastre de subárbol usa exclusivamente eventos HTML5 nativos, sin
    manejo táctil ni alternativa completa por teclado.
13. Tres documentos citan cifras de specs/tests desactualizadas: el perfil
    FONDEF ("35 specs, 1.206 pruebas"), `docs/test-obligations.md` ("34
    specs"). La cifra real hoy es 38 specs, 1298 pruebas.
14. `federated-sharing.allium` y `peer-networking.allium` no se referencian
    entre sí pese a describir la misma federación desde ángulos
    complementarios.
15. Un invariante citado en código (`EveryLinkIsHumanlyConfirmed`,
    `packages/server/src/transcribe.ts:6`) no existe en ninguna de las 38
    specs.
16. Un mismo nombre de invariante (`TheModelIsLocalOrThereIsNone`) está
    declarado de forma independiente en dos specs sin relación de importación
    entre ellas.

## Inferencias

Estas son lecturas razonadas de los hechos anteriores, no observaciones
directas — se marcan como tales porque una inferencia puede estar equivocada
de un modo en que un hecho verificado no puede.

1. **El roadmap de Vera es honesto pero optimista en un punto concreto:**
   marca "fluidez de edición estructural" como hecho, y el código que lo
   sostiene es real y disciplinado (cada invariante citado en el lugar
   correcto) — pero la prueba automatizada de esa fluidez es mucho más débil
   de lo que sugieren los nombres de los archivos de test. No es que el
   roadmap mienta: es que "hecho" y "probado con la misma vara que el resto
   del dominio" no son lo mismo aquí, y esa distinción no es visible sin abrir
   el código.
2. **El patrón de deuda declarada dentro de la propia spec (`change-application.allium`,
   `mcp-server.allium`, `service-connections.allium`) es una práctica sana que
   vale la pena generalizar** — es más fácil confiar en una spec que dice "esto
   falta" que en una que calla y deja que el código lo descubra.
3. **La causa probable de las cifras desactualizadas (E-7) no es descuido
   puntual sino ausencia de una fuente única generada:** tres documentos
   distintos escriben el mismo número a mano, en momentos distintos, y los
   tres han quedado atrás según el sistema creció. Un documento que calcula en
   vez de declarar (`ls specs/*.allium | wc -l`) no puede desactualizarse de
   esta forma.
4. **La ausencia de vía de alta humana para el dueño (E-1) probablemente no es
   un olvido sino una consecuencia de construir primero para invitados** (que
   sí necesitaban la ceremonia completa desde el primer día de espacios
   compartidos) y postergar el caso del dueño porque "sin credencial = dueño"
   seguía funcionando en la práctica. Es exactamente el tipo de brecha que
   sólo aparece al intentar cerrarla, como ya advierte
   `docs/plan-nadie-por-omision.md`.
5. **El repositorio está en buen estado para recibir contribución multiagente
   en lo procedimental** (`CONTRIBUTING.md` ya cubre ramas, commits, PR,
   seguridad y autoría con un detalle inusual) **pero no en lo referente a
   colisión de archivos grandes**: `server.ts`, `outliner.ts` y `main.ts`
   concentran una fracción alta de la superficie de cambio de casi todas las
   unidades de la cola priorizada. Varios agentes trabajando la fase 1 en
   paralelo van a tocar `server.ts` con frecuencia — esto no es un defecto del
   protocolo, es una característica del código que el protocolo debe tener
   presente.

## Recomendaciones

Ordenadas por la fase 1, que es la que el encargo pidió empezar primero.

1. Cerrar u1.1 (captura de fallos de persistencia) antes que cualquier otra
   unidad de la fase 1: es la de menor riesgo y mayor apalancamiento, y todo
   lo demás en la fase escribe al mismo log.
2. No empezar u1.3 (respaldo/restauración) sin resolver antes u1.3b (cifrado
   de secretos) — el orden importa aquí más que en la mayoría de las unidades.
3. Tratar E-1 (vía de alta del dueño) como una decisión de producto explícita
   antes de tocar código de `human-auth.ts` — las dos opciones descritas en
   `decisiones-y-preguntas-abiertas.md` tienen consecuencias de seguridad
   distintas y no conviene que la implementación decida por omisión.
4. Elevar el rate-limiting (u2.1) y el límite de tiempo del MCP público (u2.2)
   por delante de su posición nominal en el roadmap ("endurecimiento para
   red", listado al final de la sección 2): hoy el corpus corre en loopback,
   pero cualquier paso hacia el modo 2 o el modo 3 de `docs/exponer-vera.md`
   hereda esta ausencia sin aviso.
5. Antes de escribir una sola línea de red horizontal (u1.5b), resolver la
   costura entre `peer-networking.allium` y `federated-sharing.allium`
   (u1.5a) — es más barato en spec que en código.
6. Adoptar el hábito, ya presente en `change-application.allium` y
   `mcp-server.allium`, de declarar deuda de implementación dentro de la
   propia spec cuando se descubra, en vez de dejarla implícita.
7. Corregir las cifras desactualizadas (E-7) antes de cualquier uso externo
   del perfil FONDEF — es una corrección de minutos con un costo de
   credibilidad desproporcionado si se pospone.

## Decisiones que Herbert debe tomar

Estas no las puede tomar un agente por su cuenta — son de producto, de
seguridad, o de alcance institucional. Cada una está desarrollada en
`decisiones-y-preguntas-abiertas.md` con sus opciones; aquí sólo se enumeran
para que quede claro que están pendientes y de quién es la decisión.

1. **E-1 — cómo se autentica el dueño ante su propia instancia**: construir
   el *bootstrap* de passkey que `shared-space-access.allium` ya especifica,
   o retirarlo de la spec y usar el mecanismo de `issue-owner.ts` adaptado al
   navegador. Bloquea el cierre de `NobodyIsAssumed`.
2. **E-4 — cómo se protegen los secretos de servicios de terceros**: cifrado
   con clave derivada de la máquina, cifrado con passphrase de la persona, o
   exclusión de cualquier respaldo con reconexión manual. Bloquea el cierre
   responsable de respaldo/restauración.
3. **E-5 — política de revocación al recuperar la raíz**: si `issue-owner.ts`
   debe revocar automáticamente las credenciales raíz anteriores o pedir
   confirmación antes de sumar una nueva.
4. **E-6 — relación entre `peer-networking.allium` y `federated-sharing.allium`**:
   qué costura declarar entre ambas antes del prototipo de red horizontal.
5. **Identidad federada** ([[Vera — Identidad federada]], ya declarada en el
   corpus): WebID/Solid-OIDC frente a identificadores portables propios. No es
   un hallazgo nuevo de esta auditoría, pero se cita aquí porque bloquea la
   fase 3 y esta auditoría no encontró evidencia de que la decisión haya
   avanzado desde que se escribió.
6. **Alcance de esta misma auditoría hacia FONDEF**: si las cifras corregidas
   (38 specs, 1298 pruebas) y los riesgos de seguridad nuevos aquí encontrados
   (rate-limiting ausente, secretos en texto plano, autenticación del dueño
   incompleta) deben incorporarse al diagnóstico de madurez tecnológica del
   perfil FONDEF antes de la próxima revisión de ese documento — dado que
   varios de estos hallazgos son precisamente el tipo de brecha que un comité
   técnico externo puede encontrar por su cuenta.

## Lo que este informe no hace

No prioriza entre las decisiones anteriores más allá del orden de la fase 1.
No estima tiempos: ninguna unidad de `cola-priorizada.md` lleva una fecha,
porque esta auditoría no tiene base para prometer una. No evalúa si el
perfil FONDEF debe postularse — eso es una decisión institucional fuera del
alcance de una auditoría técnica de repositorio.
