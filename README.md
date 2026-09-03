<p align="center">
  <img src="https://vera.mediafranca.net/assets/vera_vera-logo.svg" width="112" alt="Logo de Vera">
</p>

# Vera

> Una memoria viva para profundizar y trabajar con inteligencias artificiales
> sin entregar el control de tu conocimiento.

![Vera muestra una página y su grafo de relaciones](https://vera.mediafranca.net/assets/vera-interface.png)

Vera es una wiki personal, *local-first* y mantenible por personas y agentes. El
proyecto se documenta desde su propio corpus para no sostener versiones paralelas
de la misma explicación.

## Conocer Vera

- [Presentación](https://vera.mediafranca.net/vera/)
- [Manual](https://vera.mediafranca.net/vera-manual/)
- [Principios](https://vera.mediafranca.net/vera-principios/) y [postura ética](https://vera.mediafranca.net/vera-postura-etica/)
- [Hoja de ruta](https://vera.mediafranca.net/vera-roadmap-de-producto-y-desarrollo/)
- [Arquitectura](https://vera.mediafranca.net/vera-arquitectura/)
- [Seguridad](https://vera.mediafranca.net/vera-seguridad/)
- [Probar e instalar](https://vera.mediafranca.net/vera-probar-e-instalar/)

Vera es actualmente una **alfa de investigación**: funciona sobre un corpus
real, pero está destinada por ahora a una persona y un grafo. No es todavía un
servicio multiusuario listo para producción.

> [!WARNING]
> La aplicación privada escucha en loopback por omisión. No expongas directamente
> ese puerto a Internet: las personas aún no se autentican ante Vera. Lee
> [Seguridad](SECURITY.md) y [Exponer Vera](docs/exponer-vera.md) antes de cambiar
> la frontera de red.

## Levantar el repositorio

Requiere Node.js 24 o posterior.

```sh
git clone https://github.com/mediafranca/vera.git
cd vera
npm install
cp .env.example .env          # define VERA_OWNER y VERA_OWNER_NAME
npm run build
npm run serve                 # http://127.0.0.1:4173
```

Antes de escribir en una instancia propia, sigue la guía de
[portabilidad](docs/portabilidad.md): la identidad inicial determina quién firma
las operaciones del grafo. Para desarrollar también hacen falta el validador de
Allium y los pasos de [CONTRIBUTING.md](CONTRIBUTING.md).

La distribución de escritorio, la memoria inicial y el circuito de releases
para Windows y macOS se describen en
[Distribución de Vera Desktop](docs/distribucion-escritorio.md).

```sh
npm run spec
npm run typecheck
npm test
```

## Documentación del código

El [índice técnico](docs/README.md) reúne arquitectura de implementación,
conexión MCP, portabilidad, exposición, obligaciones de prueba y planes de
trabajo. Las [especificaciones Allium](specs/) son la fuente de verdad del
comportamiento.

Vera se publica bajo [GNU AGPL-3.0-only](LICENSE). Consulta también
[LICENCIA.md](LICENCIA.md), [AUTHORS.md](AUTHORS.md),
[CONTRIBUTING.md](CONTRIBUTING.md) y [NOTICE](NOTICE).

<p align="center">
  <img src="https://vera.mediafranca.net/assets/raised-fist.svg" width="104" alt="Puño alzado">
</p>

<p align="center"><strong>Soberanía digital</strong></p>

<p align="center">
  <small>Puño alzado: Eugenio Hansen, OFS — trabajo propio,
  <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>, vía
  <a href="https://commons.wikimedia.org/w/index.php?curid=65787095">Wikimedia Commons</a>.</small>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mediafranca/mediafranca.github.io/refs/heads/main/assets/logo/mf.svg" width="72" alt="MediaFranca">
</p>

<p align="center">Vera forma parte de <a href="https://mediafranca.net/">MediaFranca</a>.</p>
