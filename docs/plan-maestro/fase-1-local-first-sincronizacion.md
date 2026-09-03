# Plan de ejecución — Fase 1: soberanía local-first y sincronización

Estado al escribirlo: 2026-08-30. Esta fase corresponde al punto 1 del encargo
de auditoría y a la sección 1 del roadmap de Vera
([[VERA — Soberanía local-first y continuidad sin red]]). Es la fase con más
evidencia verificada de todo el repositorio y la que bloquea a todas las
demás: el propio roadmap lo dice como "dependencia crítica" — la red horizontal
necesita primero soberanía local-first, identidad humana, permisos de espacios
compartidos, respaldo/portabilidad y una aplicación instalable.

Las unidades siguientes están ordenadas por dependencia, no por número de
sección. Cada una es entregable por su cuenta, como ya es la costumbre de
`docs/plan-local-first.md`.

---

## 1.1 — Cerrar la deuda de integridad de escritura conocida

### Objetivo observable
Un fallo de persistencia (SQLite ocupado, disco lleno, restricción violada) en
cualquiera de los puntos de escritura del servidor deja al proceso en un estado
consistente con el disco — nunca sirviendo un grafo en memoria que el disco no
tiene — y lo dice, en vez de fallar en silencio.

### Alcance
Los nueve sitios de `server.ts` que llaman `graph.submitOperation()` seguido de
`recordOperation()` sin capturar el fallo de persistencia: Zotero (`:836`),
conexiones (`:2490`), proposals (`:2102`), vera-file (`:2821`, `:3092`), agente
(`:4098`), undo (`:4462`, `:4487`). El patrón correcto ya existe en
`server.ts:1452-1476` (el POST de operaciones directo): generalizarlo, no
reinventarlo.

### Fuera de alcance
Coordinación multi-proceso (riesgo 3 de la matriz) — es un problema real pero
distinto, y no urge mientras Vera corra como un solo proceso por instancia.
Migración de motor de base de datos.

### Dependencias
Ninguna. Es la unidad de menor riesgo y mayor apalancamiento de toda la fase:
sin esto, cualquier otra escritura nueva (conflictos, batch, red horizontal)
hereda el mismo defecto en un décimo punto más.

### Specs afectadas
`change-application.allium` (`IdempotentOrderedApplication`, aplicación
todo-o-nada). No requiere una spec nueva: es cerrar una contradicción entre el
código y una obligación que la spec ya declara.

### Código probablemente afectado
`packages/server/src/server.ts` (los nueve sitios listados). Posible extracción
de un helper común (`submitAndRecord` o similar) para que el patrón no se
repita una décima vez.

### Pruebas de aceptación
- Test nuevo por sitio (o uno parametrizado): simular un `recordOperation` que
  lanza, y verificar que `graph` se recompone desde el log (o rechaza la
  operación) en vez de servir el estado divergente.
- `make check` en verde.

### Comandos de verificación
```sh
node --test packages/server/test/server.test.ts
npm run typecheck
```

### Riesgos de datos, seguridad, migración, rollback
Bajo. Es una corrección defensiva sin cambio de esquema ni de contrato
observable para el cliente. Rollback trivial: revertir el commit.

### Criterio de terminado
Los nueve sitios manejan el fallo de persistencia igual que `server.ts:1452`, y
un test por sitio lo demuestra.

---

## 1.2 — Completar la resolución de conflictos por bloque

### Objetivo observable
Cuando dos manos escribieron el mismo bloque, la persona ve ambas versiones con
las líneas que difieren marcadas, y puede elegir una, la otra, o escribir una
tercera — y ese recorrido completo (no sólo el cálculo del diff) está probado.

### Alcance
`packages/web/src/reconcile.ts` (`askAboutDisagreements`) y su aplicación en
`packages/web/src/main.ts:2072-2101` (`applyResolutions`). El cálculo de
desacuerdo y el diff (`behind.ts:155-220`) ya están VERIFICADOS — no se tocan,
se les añade la capa que falta encima.

### Fuera de alcance
Fusión automática de líneas (la spec la prohíbe explícitamente: el bloque es
la unidad de autoría, no la línea). Resolución de conflictos entre más de dos
versiones (no hay tercera mano posible hoy — un solo dueño, un agente).

### Dependencias
Ninguna técnica. Depende editorialmente de que 1.1 esté cerrado, porque un
conflicto es, por definición, un momento en que dos escrituras compitieron, y
conviene que la ruta de escritura de la que sale la resolución sea la misma que
ya maneja fallos de persistencia.

### Specs afectadas
`offline-reconciliation.allium` — pasos 5 ("el desacuerdo se resuelve por
bloque") ya especificados; no requiere spec nueva.

### Código probablemente afectado
`packages/web/src/reconcile.ts`, `packages/web/src/main.ts` (líneas 2072-2101 y
el punto de invocación del diálogo).

### Pruebas de aceptación
- `reconcile.test.ts` (no existe hoy): construir un desacuerdo sintético,
  invocar `askAboutDisagreements`, verificar las tres salidas (`keep_local`,
  `keep_canonical`, `replace_with_participant_edit`).
- Test de integración para `applyResolutions`: que la resolución elegida
  produzca exactamente la operación esperada en el log, ni más ni menos.

### Comandos de verificación
```sh
node --test packages/web/test/reconcile.test.ts
node --test packages/web/test/behind.test.ts
```

### Riesgos de datos, seguridad, migración, rollback
Medio. Un defecto aquí puede perder la versión no elegida si `applyResolutions`
no conserva ambas hasta que la persona decide. El código actual ya conserva
ambas versiones en el cálculo (`behind.ts`); el riesgo está en no verificar que
la aplicación respeta esa garantía bajo casos límite (desacuerdo con más de dos
líneas, bloque borrado en un lado y editado en el otro).

### Criterio de terminado
`reconcile.ts` y `applyResolutions` tienen test dedicado, las tres salidas
están cubiertas, y un caso de "bloque borrado en un lado, editado en el otro"
tiene un test explícito porque hoy no está claro qué hace el código en ese
caso.

---

## 1.3 — Restauración integral y prueba de continuidad

### Objetivo observable
Una persona puede perder la máquina, crear una instancia nueva, restaurar desde
un respaldo, y recuperar páginas, bloques, objetos, historial, relaciones y
configuración compatible — y ese recorrido está probado, no sólo documentado.

### Alcance
Esta es la unidad más grande de la fase y la que el roadmap marca íntegramente
pendiente en [[VERA — Respaldo, restauración y portabilidad]]. Incluye:
- Instantánea coherente de SQLite + almacén de objetos mientras Vera está en
  uso (no un `cp` sobre una base con WAL abierto).
- Manifiesto de respaldo con sumas de verificación.
- Recorrido de restauración en una instalación vacía.
- Tratamiento explícito de secretos: **primero** cifrar o excluir
  `service_secrets` (hoy en texto plano, `store/src/secrets.ts:52-67` — esto es
  un prerrequisito de seguridad de esta unidad, no un extra).
- Un script de ensayo de restauración repetible (`scripts/`).

### Fuera de alcance
Replicación continua o incremental (eso es sincronización, fase de red
horizontal). Cifrado de la base completa en reposo (decisión de producto
separada — ver decisiones-y-preguntas-abiertas.md).

### Dependencias
Ninguna técnica dura, pero es más barato hacerlo después de 1.1: un respaldo
tomado sobre un proceso que puede divergir silenciosamente del disco hereda esa
incertidumbre.

### Specs afectadas
Ninguna spec cubre hoy el formato de respaldo con el detalle necesario
(`offline-reconciliation.allium` y `core.allium` cubren el log y el dominio,
no el empaquetado). **Esto requiere una spec nueva** —
`backup-and-restore.allium` o extender `core.allium`— antes de escribir código,
según el método del repositorio (`elicit` primero).

### Código probablemente afectado
`packages/store/src/` (nuevo módulo de empaquetado/restauración),
`packages/server/src/secrets.ts` (cifrado), `scripts/` (nuevo script de
respaldo/restauración/ensayo), posiblemente `packages/store/src/migrations.ts`
si el formato portable necesita versión propia distinta de `user_version`.

### Pruebas de aceptación
- Restaurar en una instalación vacía y verificar `GET /invariants` sobre el
  resultado.
- Corromper deliberadamente un objeto y verificar que la restauración lo
  detecta (suma de verificación).
- Migrar un respaldo tomado en una versión anterior del esquema.
- Verificar que un respaldo no contiene secretos en texto plano.

### Comandos de verificación
Por definir junto con la spec — probablemente un nuevo script
`scripts/backup.sh` / `scripts/restore.sh` con su propio test de humo, más
`node --test packages/store/test/backup.test.ts`.

### Riesgos de datos, seguridad, migración, rollback
Alto, y es exactamente el riesgo que esta unidad existe para eliminar: hoy, si
la máquina de Herbert se pierde, no hay recorrido probado para recuperar el
corpus. Cifrar `service_secrets` antes de tocar el resto evita que el primer
respaldo funcional sea también la primera filtración de claves de terceros.

### Criterio de terminado
Un ensayo de restauración completo, documentado y repetible, corrido sobre una
máquina distinta de la original, con evidencia fechada (igual que
`docs/plan-local-first.md` documenta sus medidas). Sin esto, "TRL 6" (ver
informe-final.md) no se puede sostener ante nadie externo al proyecto.

---

## 1.4 — Cerrar `NobodyIsAssumed` (pasos 2 a 5 de `plan-nadie-por-omision.md`)

### Objetivo observable
Ninguna petición sin credencial participa como el dueño. La aplicación web
porta su propia credencial; las conexiones MCP tienen la suya; un modo
estricto, apagado por omisión, puede probarse antes de activarse en la
instancia real.

### Alcance
Exactamente lo que `docs/plan-nadie-por-omision.md` ya mide y deja pendiente:
paso 2 (el navegador recibe y guarda su credencial), paso 3 (credencial propia
para las tres conexiones MCP), paso 4 (modo estricto apagado por omisión), paso
5 (encenderlo). Ese documento ya tiene la medida exacta (25 obligaciones vía
`allium plan`) y no se repite aquí.

### Fuera de alcance
Autenticación de múltiples personas, roles y permisos de colaborador — la
propia spec los declara preguntas 3 y 4, sin bloquear esta unidad.

### Dependencias
Ninguna hacia 1.1-1.3. Pero **es dependencia dura de la fase 3 (red horizontal
y espacios compartidos)** y de que el dueño mismo pueda autenticarse (hallazgo
E-1): hoy `AuthenticatedOwner` no tiene vía de alta porque nadie forzó su
existencia — el propio dueño entra por el atajo "sin credencial = dueño" que
esta unidad elimina. Cerrar esta unidad **obliga** a resolver E-1 en el mismo
movimiento: no se puede apagar "sin credencial = dueño" sin que el dueño tenga
antes una credencial real que presentar.

### Specs afectadas
`identity-access.allium`, `shared-space-access.allium` (que ya define el
mecanismo de *bootstrap* de passkey para el dueño que hoy no tiene código —
ver E-1).

### Código probablemente afectado
`packages/web/src/api.ts` (portar credencial en cada petición),
`packages/server/src/server.ts:752,245` (las dos líneas que hoy asumen al
dueño), `packages/server/src/human-auth.ts` (extender el flujo de
*enrollment* del dueño), `packages/mcp/src/http.ts` (credencial propia para
MCP).

### Pruebas de aceptación
Las que ya anticipa `plan-nadie-por-omision.md` §6, más: un test que confirme
que `AuthenticatedOwner` puede registrar su propia passkey sin pasar por
`redeemInvitation` (hoy la única vía de *enrollment* que existe).

### Comandos de verificación
```sh
node --test packages/server/test/human-auth.test.ts
node --test packages/server/test/shared-space-access.test.ts
npm run spec
```

### Riesgos de datos, seguridad, migración, rollback
Alto por diseño: el paso 5 es un interruptor que puede dejar a la propia
aplicación sin acceso si el paso 2 no está completo. `plan-nadie-por-omision.md`
ya lo resuelve con el paso 4 (modo estricto apagado por omisión, probado antes
de encenderse) — seguir ese orden, no saltarlo.

### Criterio de terminado
El modo estricto está encendido en la instancia real y `server.ts:752`/`:245`
ya no existen como caída al dueño. `AuthenticatedOwner` tiene una vía de alta
propia y documentada.

---

## 1.5 — Prototipo de red horizontal entre dos instancias

### Objetivo observable
Dos instancias soberanas de Vera reales se emparejan mediante invitación,
establecen transporte, autorizan un espacio compartido, sincronizan su
subgrafo, se desconectan, reconcilian al volver, y una puede revocar a la otra.

### Alcance
El "corte vertical inicial" que [[VERA — Red horizontal entre instancias]] ya
define, punto por punto. No empieza hasta que 1.1-1.4 estén cerrados: el propio
roadmap lo declara dependencia crítica, y esta auditoría lo confirma con
evidencia de código — `peer-networking.allium` y `federated-sharing.allium`
están completamente sin implementar y no se referencian entre sí (ver E-6).

### Fuera de alcance
Federar todo el grafo. Adoptar infraestructura permanente (Solid, any-sync)
antes de tener evidencia propia del corte vertical.

### Dependencias
1.1, 1.2, 1.3, 1.4 completas. Además, antes de escribir código: resolver E-6
(costura entre `peer-networking.allium` y `federated-sharing.allium`) porque
sin ella una `Distribution` no tiene forma declarada de viajar por un
`PeerConnection`.

### Specs afectadas
`peer-networking.allium`, `federated-sharing.allium` — probablemente
requieren una revisión conjunta (`tend`) antes de implementar, para declarar
el `use` que hoy falta entre ambas.

### Código probablemente afectado
Todo nuevo: no hay ningún archivo existente que toque este dominio (verificado:
cero ocurrencias de `peer`/`federat` en `packages/server/src`,
`packages/mcp/src`, `packages/store/src`).

### Pruebas de aceptación
Un ensayo real entre dos instalaciones (no simuladas dentro del mismo proceso),
igual que pide el roadmap: "prototipo extremo a extremo entre dos instalaciones
reales".

### Comandos de verificación
Por definir junto con la spec revisada.

### Riesgos de datos, seguridad, migración, rollback
Alto: es la primera vez que el corpus de una persona cruza la red hacia otra
instancia con autoridad propia. No empezar sin 1.4 cerrado sería exponer una
superficie de red nueva sobre una base donde "sin credencial = dueño" todavía
es cierto en alguna parte.

### Criterio de terminado
El corte vertical de [[VERA — Red horizontal entre instancias]] funciona entre
dos máquinas reales y cada uno de sus cinco puntos tiene evidencia
reproducible.

---

## Fases 2 a 8 — esquema (profundidad menor, misma forma)

Las fases siguientes se describen con el mismo formato pero sin el mismo nivel
de detalle que la fase 1, porque el encargo pide empezar por el punto 1 y
porque varias dependen de decisiones que la fase 1 todavía no cierra.

### Fase 2 — Identidad, acceso y seguridad (más allá de `NobodyIsAssumed`)
- **Objetivo:** administración de participantes y membresías; autorización de
  toda lectura/búsqueda/archivo/escritura (hoy sólo escritura está cercada,
  ver `confined-writing.allium`); auditoría de accesos y límites de tasa.
- **Depende de:** 1.4.
- **Specs:** `identity-access.allium` (preguntas 1, 2, 4, 5 aún abiertas).
- **Riesgo destacado por esta auditoría, no declarado en el roadmap:** cero
  rate-limiting en ninguna puerta hoy (API, human-auth, invitaciones, MCP) —
  esta fase debería absorberlo explícitamente, no dejarlo para "endurecimiento
  para red" al final.

### Fase 3 — Compartir y federar (más allá del prototipo de 1.5)
- **Objetivo:** identidad federada, sincronización federada, conflictos y
  retractación entre instancias, moderación, continuidad tras retiro.
- **Depende de:** 1.5 y fase 2.
- **Specs:** `federated-sharing.allium`, `peer-networking.allium` (con la
  costura de E-6 ya resuelta).
- **Decisión pendiente declarada:** WebID/Solid-OIDC vs. identificadores
  portables propios (ver [[VERA — Identidad federada]]).

### Fase 4 — Escribir, pensar y recorrer (cerrar lo parcial)
- **Objetivo:** cerrar las brechas de prueba de fluidez de edición estructural
  (integración DOM, touch, teclado); construir conversación con Cotito
  (`agent-conversation.allium`, hoy 100% spec); completar integración
  bibliográfica con re-sincronización real.
- **Depende de:** nada técnico de las fases 1-3; puede avanzar en paralelo.
- **Riesgo destacado:** construir sobre `agent-participation.allium` (ya
  VERIFICADO) evita reinventar credenciales/autoría para la conversación.

### Fase 5 — Procesamiento y extensibilidad
- **Objetivo:** arquitectura de procesamiento extensible, formas por tipo de
  página/bloque (`processing-forms.allium`, hoy huérfana), gestión interna de
  procesadores.
- **Depende de:** nada técnico duro; se beneficia de que la conversación con
  Cotito (fase 4) ya exista, porque comparten el concepto de propuesta
  revisable antes de aplicar.

### Fase 6 — VeraAgentManifest (Cotito → OpenClaw)
- **Objetivo:** proyección versionada, revisable y sanitizada de la
  configuración humana de Cotito hacia archivos operativos de OpenClaw, con
  diff, activación y rollback; secretos sólo por referencia, nunca copiados al
  grafo.
- **Depende de:** fase 4 (conversación con Cotito) comparte el adaptador
  Vera-OpenClaw; conviene diseñarlos juntos aunque se entreguen por separado.
- **Estado verificado:** cero código, cero spec. Esta auditoría no encontró
  ni siquiera un archivo `.allium` para VeraAgentManifest — es la única
  capacidad de todo el roadmap sin ninguna especificación, ni implementada ni
  huérfana. **Necesita `elicit` antes que nada.**

### Fase 7 — Producto transferible
- **Objetivo:** aplicación distribuible, instalación/actualización guiadas,
  migraciones, diagnóstico, firma, canales de actualización, matriz de
  plataformas, onboarding y piloto con personas distintas del creador.
- **Depende de:** 1.3 (respaldo/restauración) es prerrequisito explícito según
  el propio roadmap y según el diagnóstico TRL de [[VERA — FONDEF IDeA I+D 2027]].
- **Estado verificado (2026-09-02):** implementados el empaquetado Windows
  NSIS/portable, el empaquetado macOS universal DMG/ZIP, el workflow único por
  push/tag y el cliente de actualización estable con descarga consentida y
  aplazamiento. Pendientes: incorporar las identidades de firma, ejecutar la
  prueba A → B en máquinas limpias, diagnóstico y piloto externo. Véase
  [`docs/distribucion-escritorio.md`](../distribucion-escritorio.md).

### Fase 8 — Repositorio preparado para contribución simultánea de muchos agentes
- **Objetivo:** ver [protocolo-agentes-contribuyentes.md](protocolo-agentes-contribuyentes.md)
  y [cola-priorizada.md](cola-priorizada.md) — esta fase ya tiene su propio
  entregable en este plan maestro y no requiere una sección adicional aquí.
