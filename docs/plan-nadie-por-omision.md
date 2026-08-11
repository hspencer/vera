# Plan: nadie por omisión

Estado al escribirlo: rama `v0.4-local-first`, `allium check specs/` en 0 errores
y 10 avisos sobre 33 specs, árbol con trabajo en curso sin confirmar
(`waiting.allium`, `held.ts`). Vera corre en modo privado sobre la tailnet.

Este documento existe porque `specs/identity-access.allium` describe un
comportamiento que el código contradice, y porque el hueco resulta ser más
pequeño de lo que parece **si se deja fuera lo que no hace falta decidir
todavía**. Dice cuánto falta, qué se rompe al arreglarlo, y qué no decide.

Es el paso 1 de [exponer-vera.md](exponer-vera.md), y prerrequisito de los dos
modos públicos.

## 1. La contradicción

| Sitio | Qué hace | Qué dice la spec |
| --- | --- | --- |
| `server/src/server.ts:752` | leer sin credencial devuelve el dueño | `@invariant NobodyIsAssumed` |
| `server/src/server.ts:245` | escribir sin credencial escribe como el dueño | `rule UnauthenticatedSubmissionIsRefused` |
| — | no existe forma de que una persona se autentique | `contract HumanAuthentication` |
| — | nada comprueba si una petición nace en la máquina | `rule TheOwnerIssuesFromTheMachine` |

`allium plan specs/identity-access.allium` da **25 obligaciones**:

| Categoría | |
| --- | ---: |
| `rule_failure` | 9 |
| `rule_success` | 4 |
| `contract_signature` | 3 |
| `invariant` | 3 |
| `rule_entity_creation` | 2 |
| `entity_fields` | 1 |
| superficie (actor, exposición, provisión) | 3 |

Con prueba hoy: la administración de participantes por el dueño, en
`core/test/change-application.test.ts:550`. Todo lo que toca autenticación, no.

## 2. El hallazgo que cambia el tamaño del problema

**La aplicación web no manda ninguna credencial.** No hay una sola cabecera
`Authorization` en `packages/web/src/`. El navegador entra como todo el mundo:
sin nada, y por eso es el dueño.

O sea que `NobodyIsAssumed` **no es cambiar dos líneas**. Cambiar esas dos líneas
deja la aplicación con 401 en cada pantalla. El trabajo real no es negar al
anónimo: es que la aplicación deje de serlo.

Y de ahí sale lo segundo, que es lo que abarata el plan:

**Para cerrar esta contradicción no hace falta responder las seis preguntas
abiertas de la spec.** Cinco de las seis —dónde vive la credencial de un
colaborador, si caduca, si los permisos son por rol o por capacidad, cuándo
expira una sesión, qué pasa con las operaciones pendientes tras revocar— son
preguntas sobre **varias personas**. Aquí hay una. Una persona, una credencial,
una máquina.

La sexta —cómo se recupera la propiedad si se pierde todo— sí hay que
responderla, y la spec ya la respondió: `TheMachineIsTheLastResort`.

Esto no es aplazar el problema: es notar que el problema pequeño es el que hoy
hace daño. Multiusuario sigue fuera de alcance, declarado como tal en el README.

## 3. Lo que se rompe al arreglarlo

Todo lo que hoy entra sin credencial, que es más de lo que parece:

| Quién | Qué le pasa | Qué necesita |
| --- | --- | --- |
| La aplicación web | 401 en cada pantalla | una sesión — el grueso del trabajo |
| Claude Code, Codex, Gemini CLI | dejan de leer | credencial propia, que la página de la puerta ya sabe emitir |
| `curl` de desarrollo, scripts | dejan de funcionar | un secreto en el entorno |
| Los procesos internos de Vera | — | ya escriben por dentro, no por HTTP |

Lo de las tres conexiones MCP no es daño colateral: es el arreglo. Hoy la propia
página de la puerta lo dice de cada una —«Entra sin credencial, así que lo que
lee queda anotado con el nombre del dueño»— y esto es lo que hace que deje de ser
verdad.

## 4. Las dos formas de que el navegador tenga credencial

**a) Sesión con formulario.** Una pantalla de entrada, una cookie, expiración.
Es lo que hará falta el día del modo 3, y trae consigo todo lo suyo: rotación,
cierre, bloqueo por intentos.

**b) Credencial fijada desde la máquina.** El navegador recibe una credencial la
primera vez que se abre Vera **desde la propia máquina**, y la guarda. No hay
formulario, no hay contraseña, no hay nada que recordar: la prueba de que eres tú
es que estás sentado delante.

La segunda es la que corresponde al modo privado, y es coherente con lo que la
spec ya declaró como raíz de confianza: quien tiene la máquina puede emitirse una
credencial sin tener ninguna. No inventa un mecanismo nuevo — es el mismo
`TheOwnerIssuesFromTheMachine`, con el navegador local como quien lo pide.

Y deja el camino abierto: el día que haga falta el formulario, se añade encima
sin deshacer nada, porque la credencial ya es la misma entidad.

## 5. `is_local_to_the_instance`

Hoy no hay ni una línea en el servidor que mire de dónde viene una conexión. Hace
falta, y tiene una trampa:

**No se puede confiar en `X-Forwarded-For` ni en ninguna cabecera.** Un proxy
delante —y en el modo 2 o 3 lo habrá— puede ponerlas a lo que sea. La comprobación
tiene que ser sobre la dirección real del socket, y la spec ya avisa de por qué
importa tanto: *«es también la razón por la que la instancia no debe ser
alcanzable de esa manera desde una red»*.

Exposición y recuperación no pueden confundirse. Si el día de mañana un proxy
publica Vera, esta ruta tiene que seguir siendo inalcanzable desde fuera, por
construcción y no por configuración.

## 6. Los pasos

| # | Paso | Rompe algo |
| --- | --- | --- |
| 1 | `is_local_to_the_instance` sobre el socket, y la emisión desde la máquina | no |
| 2 | Que el navegador local reciba y guarde su credencial, y la mande en cada petición | no |
| 3 | Credencial propia para las tres conexiones MCP que hoy no la tienen | no |
| 4 | Un modo estricto, apagado por omisión, que niega al anónimo | no |
| 5 | Encender el modo estricto y quitar la caída al dueño | **sí, todo lo que quede sin credencial** |

Los cuatro primeros pasos no rompen nada y se pueden hacer sueltos. El paso 5 es
un interruptor, y con los cuatro anteriores hechos ya no debería quedar nadie del
otro lado.

El paso 4 existe justo para eso: encender el interruptor y ver quién se cae, en
una instancia de pruebas, antes de encenderlo en la de verdad. Sin él, el paso 5
es un salto a ciegas sobre un corpus de años.

## 7. Lo que este plan no decide

- **Multiusuario.** Sigue fuera de alcance. Aquí hay una persona.
- **Caducidad de credenciales.** La de un agente no caduca hoy; la de una persona
  tampoco lo hará en este plan. Es la pregunta abierta 3 de la spec y se
  responderá cuando haya a quién echar de menos.
- **Roles y permisos de colaborador.** Pregunta abierta 4. No aparece mientras el
  grafo tenga un solo habitante.
- **Cómo se ve la entrada.** Si algún día hay formulario, su forma es asunto de
  `workspace-interface.allium`, no de aquí.
- **El sitio público.** Es [exponer-vera.md](exponer-vera.md), paso 2 en adelante.
  Este plan sólo lo desbloquea.
