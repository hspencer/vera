# Cola priorizada de unidades de trabajo

Estado al escribirlo: 2026-08-30. Fotografía, no tablero de estado — ver
[protocolo-agentes-contribuyentes.md §7](protocolo-agentes-contribuyentes.md).
La autoridad sobre si una unidad está hecha es `make check` más el código, no
esta lista. Identidad estable: cada unidad conserva su `id` aunque se
reordene; no reutilices un `id` para algo distinto.

Ordenadas por la fase 1 primero (es el punto 1 del encargo), luego por las
demás fases en el orden del roadmap. Dentro de la fase 1, en orden de
dependencia real, no de número.

## Fase 1 — soberanía local-first y sincronización

### u1.1 — Capturar el fallo de persistencia en los nueve sitios de escritura que no lo hacen
- **Hecho (2026-08-30):** rama `v0.6-fallo-persistencia`, commit `de661e9`.
  `make check` en verde (1299 tests, typecheck y build limpios). Encontró un
  décimo sitio no anticipado (transcripción de voz, ~línea 3229) que ya tenía
  `try/catch` pero no reconstruía el grafo; también corregido.
- **Dependencias:** ninguna.
- **Archivos previstos:** `packages/server/src/server.ts` (líneas ~836, 2102,
  2490, 2821, 3092, 4098, 4462, 4487 — confirmar con grep antes de tocar, el
  código pudo moverse).
- **Test de verdad:** un test por sitio (o parametrizado) que simule
  `recordOperation` lanzando y verifique que el proceso no sirve un grafo
  divergente del disco.
- **Riesgos:** bajo. Sin cambio de esquema ni de contrato observable.
- **Detalle completo:** `fase-1-local-first-sincronizacion.md §1.1`.

### u1.2 — Test de integración para resolución de conflictos por bloque
- **Hecho (2026-08-30):** rama `v0.6-resolucion-conflictos`, commit `057e375`.
  `make check` en verde (1310 tests). Encontró y corrigió una pérdida de datos
  real: `applyResolutions` soltaba lo pendiente de la bandeja antes de intentar
  el reemplazo; si el envío era rechazado, ninguna de las dos versiones
  sobrevivía. Queda documentado y sin resolver, a propósito, un caso distinto:
  `keep_canonical` no cancela un `remove_block` ya en cola del mismo bloque —
  es una decisión de producto nueva, no tomada aquí.
- **Dependencias:** ninguna técnica; se beneficia de u1.1 primero.
- **Archivos previstos:** `packages/web/src/reconcile.ts`,
  `packages/web/src/main.ts:2072-2101`, `packages/web/test/reconcile.test.ts`
  (nuevo).
- **Test de verdad:** las tres salidas (`keep_local`, `keep_canonical`,
  `replace_with_participant_edit`) probadas de punta a punta, más el caso
  límite "bloque borrado en un lado, editado en el otro".
- **Riesgos:** medio — posible pérdida de la versión no elegida si
  `applyResolutions` no conserva ambas hasta la decisión.
- **Detalle completo:** `fase-1-local-first-sincronizacion.md §1.2`.

### u1.3a — Elicitar `backup-and-restore.allium` (o extender `core.allium`)
- **Dependencias:** ninguna.
- **Archivos previstos:** `specs/` (nuevo archivo o extensión).
- **Test de verdad:** `allium check specs/` limpio sobre la spec nueva.
- **Riesgos:** bajo, es trabajo de especificación, no de código.
- **Nota (actualizada 2026-08-30):** el cifrado de `service_secrets` (u1.3b)
  se exploró y Herbert decidió no seguir por ese camino — ver más abajo. Un
  respaldo de la base incluirá esos secretos en texto plano; si eso importa,
  la decisión de excluirlos del respaldo (o tratarlos aparte) se toma al
  elicitar esta spec, no queda pendiente de u1.3b.

### u1.3b-spec — Elicitar cómo se pide, deriva y guarda la clave de una passphrase
- **Hecha y luego retirada (2026-08-30).** Se elicitó `specs/corpus-encryption.allium`
  (rama `v0.6-cifrado-secretos-spec`, commit `c46a008`): cifrar el corpus
  entero, no sólo `service_secrets`, con passphrase, clave de recuperación y
  límite de intentos. Al ver el costo real —migrar de motor de base de datos,
  y que perder passphrase y clave de recuperación a la vez deja el corpus
  entero irrecuperable— Herbert decidió no seguir por ese camino. La spec se
  retiró del repositorio; `specs/service-connections.allium` vuelve a su
  pregunta abierta original, con una nota que registra qué se exploró y por
  qué se abandonó, para que nadie la reabra sin saberlo.
- **Estado de E-4 ahora:** sin resolver de nuevo. Los secretos de
  `service_secrets` siguen en texto plano. La autenticación del dueño queda
  enteramente resuelta por u1.4a (passkey WebAuthn), sin passphrase adicional.

### u1.3b — (retirada junto con la spec)
- No hay unidad de código que ejecutar: no hay spec vigente que implementar.
  Si en el futuro se retoma el cifrado de secretos, empieza de nuevo por
  `u1.3b-spec` con un alcance más acotado (ver las tres opciones que se le
  presentaron a Herbert el 2026-08-30 en el historial de esta conversación:
  retirar del todo, passphrase como segundo factor sin cifrar nada, o cifrar
  sólo `service_secrets` como se planteó originalmente en E-4).

### u1.3c — Construir e implementar el recorrido de respaldo/restauración
- **Dependencias:** u1.3a. (u1.3b queda retirada; el respaldo lleva
  `service_secrets` en texto plano salvo que u1.3a decida excluirlos.)
- **Archivos previstos:** `packages/store/src/` (nuevo módulo),
  `scripts/backup.sh`, `scripts/restore.sh` (nuevos).
- **Test de verdad:** restaurar en una instalación vacía, en una máquina
  distinta de la original, y verificar `GET /invariants` sobre el resultado;
  detectar un objeto corrupto vía suma de verificación.
- **Riesgos:** alto — es la unidad que prueba la soberanía prometida.
- **Detalle completo:** `fase-1-local-first-sincronizacion.md §1.3`.

### u1.4a — Resolver E-1: vía de alta humana para el dueño
- **Hecho (2026-08-30):** rama `v0.6-bootstrap-dueno`, commit `3414a6e`.
  `npm run owner:enroll-passkey -- <base.sqlite>` crea el bootstrap y una
  matrícula fuera de HTTP; `/enroll-owner/<id>?secret=…` la completa con la
  misma ceremonia WebAuthn que ya usan los invitados. `make check` en verde
  (1307 tests). Encontró un problema de entorno no relacionado con el código:
  este worktree no tenía `node_modules` propio y `@vera/store`/`@vera/core`
  resolvían al checkout principal — corregido con `npm install`; ver nota al
  final de este documento.
- **Dependencias:** ninguna (decisión ya tomada, ver
  `decisiones-y-preguntas-abiertas.md` E-1).
- **Archivos previstos:** `packages/server/src/human-auth.ts`,
  `specs/shared-space-access.allium` si se opta por (b).
- **Test de verdad:** `AuthenticatedOwner` puede registrar su propia passkey
  sin pasar por `redeemInvitation`.
- **Riesgos:** alto — es la puerta que decide quién es el dueño.

### u1.4b — Portar credencial desde el navegador en cada petición
- **Dependencias:** u1.4a.
- **Archivos previstos:** `packages/web/src/api.ts`.
- **Test de verdad:** ninguna petición del cliente llega sin cabecera de
  credencial tras esta unidad.

### u1.4c — Credencial propia para las tres conexiones MCP
- **Dependencias:** ninguna técnica hacia u1.4a/b; puede avanzar en paralelo.
- **Archivos previstos:** `packages/mcp/src/http.ts`, documentación de
  `conectar-una-ia.md`.

### u1.4d — Modo estricto apagado por omisión, y su interruptor
- **Dependencias:** u1.4a, u1.4b, u1.4c.
- **Archivos previstos:** `packages/server/src/server.ts:752,245`.
- **Test de verdad:** con el modo apagado, nada cambia; con el modo
  encendido en una instancia de pruebas, todo lo que antes entraba sin
  credencial ahora recibe 401.
- **Riesgos:** alto por diseño — es un interruptor sobre años de corpus.
- **Detalle completo:** `fase-1-local-first-sincronizacion.md §1.4`, y la
  medida original en `docs/plan-nadie-por-omision.md`.

### u1.5a — Resolver E-6: costura entre `peer-networking.allium` y `federated-sharing.allium`
- **Hecho (2026-08-30):** rama `v0.6-costura-federacion`, commit `e209d51`.
  `federated-sharing.allium` importa `peer-networking.allium` y
  `SharingDestination` gana un campo opcional `peer_identity`. Dependencia
  unidireccional a propósito: `peer-networking.allium` trata el contenido
  intercambiado como opaco y no necesita depender de vuelta. Quedó una
  pregunta abierta declarada en la spec (no resuelta en silencio): cómo
  corresponde una `Distribution` a un `SharedScope` de `peer-networking`.
- **Dependencias:** ninguna técnica; recomendado antes de cualquier código de
  red horizontal.
- **Archivos previstos:** ambas specs.
- **Test de verdad:** `allium check specs/` limpio con el `use` declarado.

### u1.5b — Prototipo de red horizontal, corte vertical inicial
- **Dependencias:** u1.1 a u1.4d completas, u1.5a.
- **Archivos previstos:** nuevos, sin precedente en el repo.
- **Detalle completo:** `fase-1-local-first-sincronizacion.md §1.5`.

## Fase 2 — identidad, acceso y seguridad (más allá de local-first)

### u2.1 — Rate-limiting en las puertas sin ninguno hoy
- **Dependencias:** ninguna.
- **Archivos previstos:** `packages/server/src/server.ts` (rutas de
  `/human-auth/*`, invitaciones), `packages/mcp/src/http.ts`.
- **Test de verdad:** un intento de fuerza bruta sobre `/human-auth/authentication/options`
  o sobre el secreto de invitación se bloquea progresivamente.
- **Riesgos:** bajo técnicamente, alto en impacto de seguridad si se pospone.
- **Nota:** no estaba en el roadmap como ítem propio; esta auditoría lo eleva
  a unidad concreta porque afecta a toda superficie pública, no sólo a MCP.

### u2.2 — Límite de tiempo por petición en la puerta MCP pública
- **Dependencias:** ninguna.
- **Archivos previstos:** `packages/mcp/src/http.ts` (`bodyOf` y el ciclo de
  vida de la conexión).
- **Test de verdad:** una conexión que no completa su cuerpo en el tiempo
  límite se cierra, sin bloquear al proceso.
- **Riesgos:** bajo.

### u2.3 — Revocar credenciales raíz anteriores al emitir una nueva
- **Dependencias:** ninguna (ver E-5).
- **Archivos previstos:** `packages/server/src/issue-owner.ts`.
- **Test de verdad:** tras dos ejecuciones, sólo el token más reciente tiene
  alcance vigente.

## Fase 4 — escribir, pensar y recorrer (puede avanzar en paralelo a la fase 1)

### u4.1 — Test de integración DOM para arrastre de subárbol y selección múltiple
- **Dependencias:** decisión de introducir jsdom/happy-dom (no existe hoy en
  ningún `package.json` del monorepo).
- **Archivos previstos:** `packages/web/src/outliner.ts`, nuevo harness de
  test.
- **Riesgos:** el harness en sí es la parte cara; una vez elegido, los tests
  individuales son baratos.

### u4.2 — Soporte táctil para arrastre de subárbol
- **Dependencias:** ninguna técnica hacia u4.1.
- **Archivos previstos:** `packages/web/src/outliner.ts:4062-4133`.
- **Test de verdad:** el gesto equivalente funciona con eventos táctiles, no
  sólo `dragstart`/`drop` nativos.

### u4.3 — Equivalente por teclado para reparentar a una posición arbitraria
- **Dependencias:** ninguna.
- **Archivos previstos:** `packages/web/src/outliner.ts` (menú contextual).

### u4.4 — Corregir la cita rota `EveryLinkIsHumanlyConfirmed`
- **Dependencias:** revisar `voice-capture.allium` con `weed` primero (ver
  E-2).
- **Archivos previstos:** `specs/voice-capture.allium`,
  `packages/server/src/transcribe.ts:6`.
- **Riesgos:** ninguno técnico; es higiene de trazabilidad.

### u4.5 — Elicitar `agent-conversation` como código: página de conversación
- **Dependencias:** ninguna técnica; se apoya en `agent-participation.allium`
  (ya VERIFICADO).
- **Archivos previstos:** nuevos, sin precedente.
- **Nota:** la spec ya existe y es detallada (585 líneas, cuatro puertas,
  modelo conceptual completo) — esto es implementación, no elicitación.

## Fase 6 — VeraAgentManifest

### u6.1 — Elicitar la spec de VeraAgentManifest
- **Dependencias:** ninguna.
- **Nota:** es la única capacidad de todo el roadmap sin ninguna spec, ni
  implementada ni huérfana. Empieza aquí, no en código.

## Documentación e higiene (sin fase, se pueden tomar en cualquier momento)

### ud.1 — Corregir cifras desactualizadas en `docs/test-obligations.md`
- **Archivos previstos:** `docs/test-obligations.md:39,52`.
- **Test de verdad:** la cifra citada coincide con `ls specs/*.allium | wc -l`
  y con la salida real de `npm test`.

### ud.2 — Resolver el acoplamiento implícito `build → test`
- **Archivos previstos:** `package.json` (raíz),
  `packages/server/test/shared-space-access.test.ts:230`.
- **Test de verdad:** `npm test` en un checkout recién clonado, sin build
  previo, no falla por falta de `dist/`.

### ud.3 — Actualizar cifras en el perfil FONDEF
- **Archivos previstos:** página [[Vera — FONDEF IDeA I+D 2027]] en el
  corpus de Vera, no en este repositorio.
- **Nota:** esta unidad no se reclama con una rama de git — se escribe
  directamente en Vera, como toda decisión editorial de ese documento.

## Nota de entorno (2026-08-30): worktrees de tarea sin `node_modules` propio

Al ejecutar u1.4a se encontró que un worktree creado por la herramienta
`EnterWorktree` del harness (a diferencia de `scripts/worktree.sh`, que instala
dependencias como parte de crearlo) puede quedar **sin `node_modules`
propio**. Cuando eso pasa, cualquier import por especificador de paquete
(`@vera/store`, `@vera/core`, `@vera/mcp`…) resuelve subiendo directorios hasta
encontrar el `node_modules` del checkout principal — silenciosamente, sin
error — y entonces el código que se prueba no es el del worktree sino el del
checkout que se suponía aislado.

No invalida lo verificado en u1.1 y u1.2: en ambas unidades, los archivos
tocados se importan por ruta relativa dentro de su propio paquete
(`../src/…`), que resuelve siempre al worktree sin importar `node_modules`.
Pero cualquier unidad futura que cambie el comportamiento de un paquete y lo
pruebe *desde otro paquete* debe empezar por confirmar
`readlink -f node_modules/@vera/<paquete>` apunta al propio worktree — y si no
hay `node_modules` en absoluto, correr `npm install` ahí antes de fiarse de
ningún resultado de `make check`.
