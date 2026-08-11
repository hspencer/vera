# Concesión de Replicación del Servicio — Vera 1.0

**Forma parte de [`LICENSE`](LICENSE)** (PolyForm Noncommercial License 1.0.0) y
sólo tiene efecto junto con ella. Donde ésta calla, rige aquélla.

Otorgante: **MediaFranca**, en calidad de custodio de los derechos patrimoniales
sobre Vera. Autor: **Herbert Spencer González**.

> **English abstract — not the operative text.** The Noncommercial license
> forbids commercial use. This document is a standing, non-exclusive offer that
> carves out one exception: **anyone may operate Vera as a paid service** — on
> their own hardware, machines and compute — provided they (1) preserve
> attribution, (2) publish the complete source of the version they operate under
> this same license, (3) let every one of their users export their entire corpus
> at any time, free and unconditionally, and (4) pay a **5% royalty** on gross
> revenue attributable to the service, exempt below **USD 10,000** of annual
> gross revenue. Selling Vera as a product, embedding it in closed software, or
> making commercial derivative works that are not the operation of the service
> remain forbidden. **The Spanish text below is the only operative one and
> controls in case of discrepancy.** Anyone intending to rely on this grant
> should obtain their own translation and legal advice.

---

## 1. Por qué existe esta concesión

Vera dice que una memoria personal debe poder vivir en hardware propio. Una
licencia que prohibiera toda explotación comercial prohibiría también que alguien
—una cooperativa, una universidad, un proveedor pequeño, una comunidad— levante
máquinas y cobre por mantenerlas encendidas para quienes no pueden hacerlo por sí
mismos. Eso sería negar en la licencia lo que el programa afirma.

Lo que la licencia prohíbe es **apropiarse de Vera**: venderla, encerrarla,
convertirla en producto ajeno. Lo que esta concesión permite es **replicar el
servicio**: correr Vera para otras personas, cobrar por el fierro, la energía, el
cómputo y el cuidado que eso cuesta, y devolver una parte a quienes la
escribieron.

La diferencia no es de grado. Vender Vera se lleva el trabajo; alojar Vera presta
un servicio sobre un trabajo que sigue siendo de todos.

## 2. Lo que se concede

MediaFranca concede a cualquier persona o entidad —de forma **permanente, no
exclusiva, mundial, libre de regalías salvo lo dicho en §5 y revocable sólo por
incumplimiento**— el derecho a **operar el software como servicio con fines
comerciales**, incluyendo:

- alojar una o varias instancias de Vera, modificadas o no, en infraestructura
  propia o arrendada;
- cobrar a terceros por el acceso a esas instancias, por su mantenimiento, su
  respaldo, su soporte, su migración o su capacitación;
- hacer sobre el software los cambios que la operación de ese servicio requiera.

Esto constituye un **propósito permitido** a efectos de la sección «Noncommercial
Purposes» de [`LICENSE`](LICENSE), y sólo para las conductas aquí enumeradas.

## 3. Lo que NO se concede

Esta concesión no autoriza, y siguen prohibidos por [`LICENSE`](LICENSE):

1. **Vender el software.** Licenciarlo, sublicenciarlo, distribuirlo a cambio de
   dinero, o incluirlo en un producto que se venda.
2. **Encerrarlo.** Incorporar Vera, en todo o en parte, a software propietario o
   de fuente cerrada.
3. **Obras derivadas comerciales que no sean la operación del servicio.** Un
   producto distinto construido sobre Vera —una aplicación, un SDK, un
   dispositivo— no está cubierto aquí.
4. **Revenderla bajo otro nombre**, o presentar el servicio como obra propia.
5. **Sublicenciar o transferir** esta concesión. Cada operador la toma de
   MediaFranca directamente, por el solo hecho de cumplir sus condiciones.

Para cualquiera de estas conductas hace falta un acuerdo separado y por escrito
con MediaFranca. La ausencia de tal acuerdo no se suple con esta concesión.

## 4. Condiciones de atribución y reciprocidad

Quien opere el servicio bajo esta concesión debe cumplir **todas** las
siguientes. Son condiciones, no obligaciones separables: incumplir una es operar
sin licencia.

### 4.1 Atribución visible

El servicio debe declarar, en un lugar accesible a cualquiera de sus usuarios sin
autenticarse (una página «acerca de», un pie, un colofón):

> Este servicio corre **Vera**, de Herbert Spencer González, bajo custodia de
> [MediaFranca](https://mediafranca.net/). Código: <enlace al repositorio de §4.2>.

El archivo [`NOTICE`](NOTICE) debe conservarse íntegro en toda copia del código,
y su línea `Required Notice:` no puede recortarse ni reescribirse.

### 4.2 Reciprocidad de fuente

El **código fuente completo y correspondiente** de la versión que efectivamente
se está operando —incluyendo modificaciones, parches, configuración de
construcción y todo lo necesario para levantar una instancia equivalente— debe
publicarse bajo esta misma licencia, en un repositorio de acceso público, y
enlazarse desde la declaración de §4.1.

La publicación debe ocurrir **a más tardar treinta (30) días corridos** desde que
la versión entra en operación, y mantenerse mientras el servicio siga en pie.

*Por qué:* si un operador con capital pudiera mejorar Vera en privado y cobrar
por el resultado, la replicación se convertiría en el mecanismo por el cual el
proyecto se bifurca hacia arriba y el original se queda atrás. Esta condición es
lo que hace que replicar sume en vez de restar.

### 4.3 Soberanía del usuario — no negociable

Toda persona usuaria del servicio replicado debe poder, **en cualquier momento,
sin costo, sin condición previa y sin trámite discrecional**, obtener una copia
completa y utilizable de su propio corpus: la base canónica con su registro de
operaciones, los objetos binarios, y la proyección Markdown.

El operador no puede:

- retener el corpus de una persona por deudas, disputas o término de contrato;
- degradar, limitar o tarificar la exportación;
- reclamar propiedad, licencia o derecho alguno sobre el contenido que sus
  usuarios escriban;
- **usar los corpus alojados para entrenar, ajustar o evaluar modelos**, ni
  cederlos a terceros con ese fin, salvo consentimiento expreso, específico,
  informado, revocable y otorgado persona por persona. El silencio no consiente,
  y aceptar los términos del servicio no es consentir.

Esta condición no admite pacto en contrario con la persona usuaria. Un
consentimiento que la renuncie es nulo a efectos de esta licencia.

### 4.4 No imponer términos incompatibles

El operador no puede sujetar a sus usuarios a condiciones que contradigan lo
anterior, ni invocar patentes, marcas o secretos para restringir los derechos que
esta licencia les reconoce.

### 4.5 Marca

Puede decirse «corre Vera», «basado en Vera», «powered by Vera». **No** puede
llamarse «Vera» al servicio, ni usarse el nombre o el logotipo de Vera o de
MediaFranca de un modo que sugiera patrocinio, auspicio, certificación o
afiliación. La atribución de §4.1 no constituye ni implica endoso.

### 4.6 Declaración

Dentro de los treinta (30) días corridos desde el inicio de la operación
comercial, el operador debe comunicar por escrito a MediaFranca: nombre de la
entidad operadora, dirección del servicio, dirección del repositorio de §4.2 y un
contacto responsable. Un cambio en cualquiera de esos datos se comunica del mismo
modo.

Aviso a: **hspencer@ead.cl**, con copia al contacto que MediaFranca publique.

## 5. Royalty

### 5.1 La tasa

**Cinco por ciento (5%)** de los **ingresos brutos atribuibles al servicio**, tal
como se definen en §5.2.

### 5.2 Qué son ingresos brutos atribuibles

Todo lo percibido, en dinero o en especie, a cambio del servicio o de algo que
sólo existe porque el servicio existe:

- suscripciones, cuotas, licencias de uso o cobros por asiento;
- alojamiento, almacenamiento, respaldo, cómputo o transcripción facturados a
  quien usa el servicio;
- soporte, mantenimiento, disponibilidad garantizada y migración de datos hacia o
  desde el servicio;
- personalización, integración o desarrollo sobre las instancias operadas;
- capacitación cuyo objeto sea el uso del servicio.

**No** cuentan: donaciones sin contraprestación; fondos públicos o filantrópicos
de investigación que no financien la prestación a usuarios de pago; ni
consultoría ajena a Vera aunque la preste el mismo operador.

«Bruto» significa antes de costos, con dos únicas deducciones: los impuestos
indirectos efectivamente enterados al fisco (IVA y equivalentes), y las
devoluciones y notas de crédito realmente cursadas.

### 5.3 Exención por tamaño

**No se debe royalty alguno** mientras los ingresos brutos atribuibles del
operador, sumados en doce meses corridos, no superen los **USD 10.000** (diez mil
dólares de los Estados Unidos de América), o su equivalente en moneda local al
tipo de cambio de cierre del período.

Superado el umbral, el royalty se calcula **sólo sobre el exceso** dentro de ese
período. Un operador que factura USD 30.000 en el año debe 5% de USD 20.000.

*Por qué:* una escuela, un colectivo o una persona que aloja Vera para veinte
conocidos y cobra el fierro no debe nada, y no debe tampoco un trámite. El
royalty aparece cuando aparece un negocio.

### 5.4 Cómo se paga

- **Periodicidad:** trimestral, dentro de los cuarenta y cinco (45) días
  corridos siguientes al cierre de cada trimestre calendario.
- **Con qué:** una liquidación que declare los ingresos brutos atribuibles del
  período, el cálculo aplicado y el monto. La liquidación se declara bajo
  responsabilidad del operador; no se exige auditoría externa.
- **A quién:** al **fondo de autoría** que administra MediaFranca, y que se
  reparte entre quienes figuran en [`AUTHORS.md`](AUTHORS.md) según lo que ese
  mismo archivo establece.
- **Destino del fondo:** remunerar la autoría y sostener el mantenimiento de
  Vera. MediaFranca publica anualmente cuánto entró y cómo se repartió.
- **Verificación:** MediaFranca puede pedir, una vez al año y con treinta días de
  aviso, la documentación contable que sustente las liquidaciones del período.
  Un operador exento por §5.3 sólo debe acreditar que lo está.

### 5.5 Lo que el royalty no compra

Pagarlo no otorga exclusividad, prioridad, soporte, garantía, hoja de ruta
influida, ni derecho alguno más allá de los de §2. Tampoco transfiere propiedad
intelectual: el operador conserva sus modificaciones como autor de ellas, y las
licencia bajo §4.2.

## 6. Autoría

La autoría de Vera corresponde a Herbert Spencer González. La Ley 17.336 sobre
Propiedad Intelectual de la República de Chile enumera en su artículo 14 las
facultades morales del autor y en su artículo 16 las declara inalienables,
siendo nulo cualquier pacto en contrario. La autoría no se ve afectada por esta
concesión, por la custodia que ejerce MediaFranca, por las modificaciones que un
operador introduzca, ni por acuerdo posterior alguno.

Quien contribuya al software pasa a ser coautor de su contribución en los mismos
términos, y se incorpora a [`AUTHORS.md`](AUTHORS.md) según el procedimiento allí
descrito.

## 7. Incumplimiento y término

El incumplimiento de cualquier condición de §4 o §5 termina esta concesión de
pleno derecho, y con ella el permiso de operación comercial: lo que quede es la
licencia no comercial de [`LICENSE`](LICENSE), bajo la cual el servicio de pago
es una infracción.

Se aplica el mismo plazo de subsanación que la licencia base: **treinta y dos
(32) días** desde la notificación escrita para volver a cumplimiento íntegro y
corregir el incumplimiento pasado. Subsanado dentro de plazo, la concesión
continúa sin interrupción.

Un incumplimiento de §4.3 —la soberanía del usuario— no se subsana con dinero. Se
subsana restituyendo a cada persona afectada el acceso completo a su corpus.

## 8. Sin garantía

Rige íntegramente la sección «No Liability» de [`LICENSE`](LICENSE). El software
se entrega **como está**. Quien lo opere para terceros asume por su cuenta las
obligaciones que contraiga con ellos; ni MediaFranca ni el autor responden por
ellas.

## 9. Ley y foro

Esta concesión se rige por la ley de la **República de Chile**. Las controversias
se someten a los tribunales ordinarios de **Valparaíso**, sin perjuicio de las
normas imperativas de protección al consumidor o de propiedad intelectual del
lugar donde opere quien la invoque.

## 10. Versiones

Esta es la **versión 1.0** de la concesión. MediaFranca puede publicar versiones
posteriores. Quien esté operando bajo una versión puede permanecer en ella o
adoptar la siguiente, a su elección; una versión nueva no revoca hacia atrás la
concesión de quien ya cumplía.

---

*Este documento fija términos con efectos jurídicos. No fue redactado por un
abogado. Antes de operar comercialmente bajo él, o de modificarlo, conviene
revisión legal — y si esa revisión encuentra un defecto, corregirlo aquí es
preferible a resolverlo en privado.*
