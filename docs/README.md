# Documentación de Vera

Las **especificaciones** están en [`specs/`](../specs/) y son la fuente de verdad
sobre el comportamiento. Lo que hay aquí es todo lo demás: cómo se usa, cómo está
construido, cómo se levanta y qué se decidió y por qué.

Si es la primera vez, el orden es: **[README](../README.md)** → **[Manual](manual.md)**
→ **[Portabilidad](portabilidad.md)**.

## Para quien usa Vera

| | |
| --- | --- |
| **[Manual](manual.md)** | Cómo se escribe, se enlaza, se pregunta y se navega. Cada tecla, cada comando, cada gesto — y qué hace exactamente cada uno. Importado del corpus, donde se sigue editando. |
| **[Conectar una IA](conectar-una-ia.md)** | Enchufar cualquier servicio —Anthropic, OpenAI, Google, Microsoft, DeepSeek, Mistral— a la puerta MCP. Cinco valores, los mismos para todos, y qué se puede y qué no. |
| **[Portabilidad](portabilidad.md)** | Levantar una instancia propia: qué instalar, qué reemplazar, cómo exponerla con Tailscale, cómo llevarse el corpus. |
| **[Exponer Vera](exponer-vera.md)** | Los tres modos de estar alcanzable —privado, público de lectura, público de acceso—, qué exige cada uno y por qué el que casi todo el mundo quiere no necesita autenticar a nadie. |

## Para quien la construye

| | |
| --- | --- |
| **[Arquitectura](architecture.md)** | La forma técnica, con lo construido y lo propuesto marcados por separado. No convierte decisiones técnicas en garantías de producto. |
| **[Anatomía de la interfaz](interfaz.md)** | Inventario de lo que hay hoy en pantalla, levantado del código y no de la memoria. Para reestructurar sabiendo qué se mueve y qué arrastra consigo. |
| **[Obligaciones de prueba](test-obligations.md)** | Qué cubre la suite y, sobre todo, qué **no**. Derivadas con `allium plan` desde las specs. |
| **[Benchmark de diseño](benchmark.md)** | Vera frente a Logseq, Obsidian, Roam y SilverBullet. Compara diseños, no productos, y lo dice. |

## Planes de trabajo

Un plan mide el hueco entre una spec y el código antes de entrar a cerrarlo. Se
escriben cuando el hueco es lo bastante grande como para que convenga saber por
dónde se entra, y se dejan escritos después, incluidos los pasos que resultaron
falsos.

| | |
| --- | --- |
| **[Que la mano no espere](plan-local-first.md)** | Local-first. En curso: pasos 0 a 3 hechos, 4 y 5 pendientes. |
| **[Del rastro al argumento](plan-recorridos.md)** | Recorridos. Cerrado — los recorridos existen. |
| **[Nadie por omisión](plan-nadie-por-omision.md)** | Que sin credencial no se sea el dueño. Sin empezar — prerrequisito de cualquier exposición pública. |

## Gobierno del proyecto

Fuera de `docs/`, en la raíz:

| | |
| --- | --- |
| **[CONTRIBUTING.md](../CONTRIBUTING.md)** | Cómo se trabaja: el método spec-first, las ramas, los commits, la revisión, la etiqueta y cómo se reporta un fallo de seguridad. |
| **[ROADMAP.md](../ROADMAP.md)** | Los tres horizontes: que la mano no espere, que la espera se vea, y la federación. |
| **[LICENCIA.md](../LICENCIA.md)** | Qué se puede y qué no, y por qué esta licencia y no otra. |
| **[AUTHORS.md](../AUTHORS.md)** | El registro de autoría, cómo se entra, y por qué no existe un cálculo estándar por commits. |
| **[LICENSE](../LICENSE)** · **[LICENSE-REPLICACION.md](../LICENSE-REPLICACION.md)** · **[NOTICE](../NOTICE)** | Los textos que obligan. |

---

## Cómo se escribe aquí

- **Un documento dice su estado al escribirlo** —qué rama, cuántas pruebas, qué
  estaba sin confirmar— para que quien lo lea después sepa contra qué se escribió.
- **Lo construido y lo propuesto se marcan por separado.** Un documento que los
  mezcla convierte una intención en un compromiso sin que nadie lo decida.
- **Lo que resultó falso se deja escrito**, tachado o corregido en su sitio, con
  lo que se descubrió. En `plan-local-first.md` hay un bloqueador que no existía;
  está ahí y dice por qué se creyó que existía.
- **Nada de aquí sustituye a una spec.** Si un documento y una spec se
  contradicen, manda la spec y el documento está desactualizado.
