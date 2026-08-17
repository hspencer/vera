# Autoría

Este archivo es el **registro de autoría de Vera**. No es una lista de
agradecimientos: documenta quién responde por aportes originales y cómo se
incorporan nuevas personas autoras.

## El registro

| Autor | Desde | Rol |
| --- | --- | --- |
| Herbert Spencer González `<hspencer@ead.cl>` | 2026-08-01 | Autor fundador. Specs, arquitectura, implementación. |

**Custodia:** [MediaFranca](https://mediafranca.net/) administra los derechos
patrimoniales de la obra fundacional que le han sido confiados y la publicación
del proyecto bajo AGPL. No es autora ni adquiere por omisión derechos sobre las
contribuciones de terceros.

Estado al 2026-08-17, sobre `b87e76e`: 305 commits, 93.620 líneas vivas, 34
especificaciones. Un solo autor.

## Sobre el cálculo de autoría por commits

**No existe un estándar. Y no es que falte: es que la pregunta está mal
planteada.**

El derecho de autor no se reparte por volumen. Protege la expresión original, y
la ley no ofrece ninguna regla que convierta actividad medible en porcentaje de
titularidad. Ante una obra en colaboración, la participación de cada quien es
**lo que las partes pacten**; a falta de pacto queda la indivisión, que es un
problema, no un reparto. Ninguna jurisdicción cuenta líneas.

Lo que sí existe son **herramientas de medición**, y todas miden otra cosa:

| Herramienta | Qué cuenta | Por qué no basta |
| --- | --- | --- |
| `git shortlog -sn` | commits | Un commit puede ser una coma o un subsistema. Premia el ritmo de confirmación, que es un hábito. |
| `git-fame`, `hercules` | líneas vivas por blame | Un `prettier` reescribe un archivo entero y su autor pasa a ser dueño de él. Borrar mil líneas que sobraban puntúa cero. |
| `git log --numstat` | líneas añadidas | Premia escribir de más. Es la métrica más fácil de inflar sin querer. |
| Recuento de PRs | unidades de entrega | Depende del tamaño con que cada quien parte el trabajo. |

Y todas comparten tres defectos que ninguna corrige:

1. **Confunden materia con decisión.** La línea que costó tres días de discusión
   pesa lo mismo que la que salió sola.
2. **No ven el trabajo que no deja rastro.** Revisar, encontrar el defecto,
   elicitar el requisito, sostener la decisión difícil, borrar bien.
3. **Se pueden inflar sin mala fe**, sólo por cómo alguien acostumbra a trabajar.

Convertir cualquiera de ellas en la regla del reparto sería sustituir una
conversación difícil por una cifra que parece objetiva porque salió de un script.

### Lo que Vera hace en su lugar

**Se mide, se publica, y se decide conversando.**

```sh
./scripts/autoria.sh          # sobre HEAD
./scripts/autoria.sh v0.4.0   # sobre una referencia
```

El script da **tres columnas separadas** —commits, líneas vivas por blame, y
especificaciones tocadas— y **se niega a promediarlas**, porque no son la misma
cosa. En un repositorio donde el comportamiento se decide en `specs/` y después
se implementa, quien escribe una spec decide *qué* hace Vera y quien la
implementa decide *cómo*: las dos son autoría, y colapsarlas en un número
borraría justamente la distinción que este proyecto sostiene.

Esas cifras son **el insumo de la conversación, no su resultado**.

### Sobre el código escrito con asistencia de modelos

Buena parte de Vera se escribió conversando con modelos de lenguaje. Una métrica
por commits o por líneas atribuiría ese trabajo a quien confirmó el commit, y hay
que decir por qué eso, aquí, está bien.

Vera ya tiene doctrina sobre esto y la aplica a su propio corpus: **la máquina no
es autora**. Cada bloque conserva de qué mano salió, lo generado nunca se disfraza
de escrito, y la firma corresponde a quien dirigió el cambio y responde por él.
El mismo criterio rige el código: **es autor quien decide, dirige y responde**,
no quien teclea ni quien genera.

Consecuencia práctica: la asistencia de un modelo **no diluye** la autoría humana
ni crea una participación para el proveedor del modelo. Y la contracara: quien
sólo pega salida de un modelo sin decidir nada tampoco es autor por haberla
pegado. Lo que se mide, cuando se mide, es el juicio.

## Cómo se entra al registro

### Quién entra

Quien haya aportado **algo por lo que responda**: una especificación, un
subsistema, una decisión de diseño sostenida, una corrección que exigió entender
el problema. No entra quien arregló una errata, tradujo una línea o afinó un
espacio en blanco — eso se agradece en el commit, que es donde queda para
siempre.

El criterio no es el tamaño. Es si la persona **tendría que estar en la sala**
cuando se decida qué hace Vera a continuación.

### Cómo entra

1. La contribución se acepta e integra por el camino de
   [`CONTRIBUTING.md`](CONTRIBUTING.md).
2. Se corre `./scripts/autoria.sh` y se publica el resultado en la conversación.
3. Herbert Spencer González, como autor fundador, y quienes ya figuren en el
   registro acuerdan con la persona cómo describir su aporte, mirando las cifras
   y todo lo que las cifras no ven.
4. El acuerdo se escribe **aquí**, en un commit propio, con fecha. Es el único
   sitio donde existe.

No hay fórmula, y no la va a haber. Lo que hay es que el acuerdo se escribe, se
firma en el historial y queda público.

## Derechos y licencia

Cada persona conserva la autoría y los derechos sobre su contribución, que se
publica como parte de Vera bajo `AGPL-3.0-only`. Contribuir no cede derechos
patrimoniales a MediaFranca ni crea un fondo o participación económica. La
autoría permanece aunque una persona deje de participar —Ley 17.336, artículos
14 y 16—.

## Reconocimientos

Trabajo que no constituye autoría del software y que Vera igualmente tiene
encima:

- **Logseq**, cuyo comportamiento de bloques se tomó como referencia y está
  destilado en
  [`logseq-block-identity-reference.allium`](specs/logseq-block-identity-reference.allium).
  No se depende de su código en tiempo de ejecución.
- **Allium** (JUXT), el lenguaje en que se especifica el comportamiento de Vera.
- Los recursos gráficos de terceros enumerados en [`NOTICE`](NOTICE).

---

*Cambiar este archivo cambia quién cobra. Se modifica en un commit propio, con el
acuerdo enlazado o citado en el mensaje, y nunca dentro de un cambio que haga
además otra cosa.*
