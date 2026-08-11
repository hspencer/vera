# La licencia de Vera, explicada

Este archivo explica. Lo que obliga es [`LICENSE`](LICENSE) y
[`LICENSE-REPLICACION.md`](LICENSE-REPLICACION.md); si algo aquí los contradice,
mandan ellos.

## En una línea

**Vera se puede usar, leer, modificar y compartir libremente sin fines de lucro.
Con fines de lucro sólo se puede hacer una cosa: alojarla para otros — pagando un
5% a quienes la escribieron y publicando lo que se modifique.**

## Qué puedo hacer

| Quiero… | ¿Puedo? |
| --- | --- |
| Instalarla en mi máquina y usarla para mi memoria personal | **Sí**, sin condiciones. |
| Leer el código, estudiarlo, aprender de él | **Sí.** |
| Modificarla para mí, o para mi laboratorio | **Sí.** |
| Usarla en una universidad, escuela, ONG, hospital, organismo público | **Sí**, aunque cobren matrícula o reciban fondos. La licencia lo dice expresamente. |
| Publicar un fork con mis cambios | **Sí**, con la misma licencia, el `NOTICE` intacto y la autoría reconocida. |
| Escribir un paper sobre ella, una tesis, una clase | **Sí.** |
| Usarla dentro de mi empresa, para trabajo de mi empresa | **No** sin acuerdo. Eso es uso comercial. |
| Venderla, licenciarla, incluirla en un producto que vendo | **No.** |
| Meterla dentro de software propietario | **No.** |
| **Levantar máquinas y cobrar por alojar Vera a otras personas** | **Sí** — es la excepción, con las condiciones de [`LICENSE-REPLICACION.md`](LICENSE-REPLICACION.md). |

## Por qué esta licencia y no otra

Las condiciones eran cuatro, y ninguna era negociable:

1. **La autoría se reconoce siempre.** No es una cortesía: es lo único que el
   autor no cede.
2. **No hay derivadas comerciales.** Nadie construye un producto sobre este
   trabajo y se lo queda.
3. **Sí hay replicación del servicio.** Alojar Vera para otros —fierro, máquinas,
   cómputo— es legítimo, y debe pagar royalty a los autores.
4. **La custodia es de MediaFranca; la autoría es de Herbert Spencer González.**

Ninguna licencia estándar cubre las cuatro. Las que se consideraron:

- **MIT / Apache-2.0.** Permiten todo, incluido lo que la condición 2 prohíbe.
  Era lo que el `package.json` declaraba por inercia, y era falso.
- **AGPL-3.0.** Su reciprocidad de red es exactamente lo que se quería para la
  replicación, pero no impide en absoluto el uso comercial: cualquiera puede
  vender AGPL. Falla la condición 2.
- **CC BY-NC-SA 4.0.** Cubre 1 y 2, pero **no está hecha para software**: no
  habla de código fuente, no concede patentes, y Creative Commons desaconseja
  explícitamente su uso en programas. Habría sido elegir el instrumento
  equivocado por comodidad.
- **Business Source License (BUSL).** Prohíbe uso en producción y se vuelve
  open source a los cuatro años. La conversión automática contradice la
  condición 2 y el diferimiento no describe lo que aquí se quiere.
- **PolyForm Noncommercial 1.0.0.** Redactada por abogados para software, breve,
  legible, con concesión de patentes, cláusula de avisos y subsanación de 32
  días. Cubre 1 y 2 y exime expresamente a instituciones educativas, públicas y
  sin fines de lucro — que es el terreno donde Vera nació.

De ahí la forma final: **PolyForm Noncommercial como base, sin tocar una coma**,
más una **concesión adicional** que abre la única puerta comercial que se quería
abrir. Modificar el texto de una licencia estándar la vuelve una licencia
desconocida que nadie puede evaluar de un vistazo; añadirle una concesión separada
y explícita conserva la base reconocible y deja el trato a la vista.

## Esto no es «open source», y conviene decirlo

Vera es **fuente disponible** (*source available*), no software libre ni open
source: la Open Source Initiative no aprueba licencias que discriminen por campo
de actividad, y ésta discrimina contra el uso comercial a propósito. La Free
Software Foundation la consideraría no libre por la misma razón.

Decirlo importa por tres motivos prácticos:

- **No se le puede llamar «open source» en una postulación, un paper o un
  README.** Sería inexacto.
- **GitHub no la reconocerá** con su etiqueta de licencia; mostrará «Other».
- **Algunas empresas prohíben a sus equipos usar código no-OSI.** Es el costo
  aceptado de la condición 2.

Lo que sí es cierto y sí se puede decir: el código está **completo y a la vista**,
cualquiera puede estudiarlo, correrlo, modificarlo y replicarlo, y la única
restricción es que no se convierta en el negocio de otro sin que sus autores
participen.

## Sobre replicar el servicio

El caso concreto que la excepción quiere permitir: alguien —una cooperativa, una
universidad, un colectivo, un proveedor pequeño— levanta servidores y ofrece
«tu Vera, alojada», cobrando lo que cuesta mantenerla en pie más un margen.

Las condiciones, en corto (las completas están en
[`LICENSE-REPLICACION.md`](LICENSE-REPLICACION.md)):

- **Atribución visible** a Vera, a su autor y a MediaFranca, sin autenticarse.
- **Publicar el código** de la versión que se opera, bajo esta misma licencia,
  dentro de 30 días. Así replicar suma en vez de bifurcar.
- **Exportación total del corpus** para cada usuario, siempre, gratis y sin
  trámite. Y prohibición de entrenar modelos con los corpus alojados salvo
  consentimiento expreso, persona por persona. Esta es la condición que no admite
  pacto en contrario: es el programa entero.
- **5% de los ingresos brutos atribuibles**, trimestral, **exento bajo USD 10.000
  anuales** y calculado sólo sobre el exceso. Quien aloja Vera para veinte
  conocidos no debe nada, y tampoco debe un trámite.

## Si vas a contribuir

Al enviar un cambio aceptas dos cosas, y no hay que firmar nada más:

1. Tu contribución entra bajo esta misma licencia y su concesión de replicación.
2. Conservas tu autoría sobre lo que escribiste, y pasas a figurar en
   [`AUTHORS.md`](AUTHORS.md) — que es también donde se define qué parte del fondo
   de royalty te corresponde.

No hay cesión de derechos patrimoniales a MediaFranca por contribuir. MediaFranca
custodia y administra la licencia; no se queda con tu trabajo. El detalle está en
[`AUTHORS.md`](AUTHORS.md) y en [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Qué queda fuera de esta licencia

- **El corpus.** El repositorio no contiene la memoria de nadie: `data/`,
  `objects/` y `.env` están fuera de git desde el primer commit. Lo que una
  persona escribe en su Vera es suyo, y esta licencia no dice nada sobre ello.
- **Los recursos gráficos de terceros**, cada uno con su licencia — están
  enumerados en [`NOTICE`](NOTICE).
- **Las dependencias de npm**, que conservan la suya y no se redistribuyen aquí.
- **Allium**, el lenguaje de especificación, que es de JUXT y tiene sus propios
  términos.

## Pendiente

- Registrar la obra en el **Departamento de Derechos Intelectuales (DIBAM)** de
  Chile. No es constitutivo de derecho —el derecho nace con la obra— pero sirve
  como prueba de fecha cierta.
- Formalizar por escrito el **encargo de custodia** entre Herbert Spencer
  González y MediaFranca: qué administra, con qué límites, y qué pasa si
  MediaFranca deja de existir. Hoy está dicho en la licencia y no en un contrato.
- Revisión legal de [`LICENSE-REPLICACION.md`](LICENSE-REPLICACION.md), que fija
  obligaciones de dinero sin haber pasado por un abogado.
