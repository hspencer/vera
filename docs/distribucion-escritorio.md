# Distribución de Vera Desktop

Vera se distribuye como una aplicación instalable para Windows y macOS. El
programa y la memoria son piezas distintas: actualizar o desinstalar el primero
no borra la segunda.

## Artefactos de una release estable

| Plataforma | Primera instalación | Actualización | Arquitectura |
| --- | --- | --- | --- |
| Windows | `Vera Setup <versión>.exe` | NSIS + `latest.yml` | x64 |
| Windows portable | `Vera <versión>.exe` | sustitución manual | x64 |
| macOS | `Vera-<versión>-universal.dmg` | ZIP + `latest-mac.yml` | Intel + Apple Silicon |

El ZIP de macOS no es otro instalador para la persona: es necesario para que el
actualizador genere `latest-mac.yml`. El DMG sigue siendo la descarga humana de
primera instalación.

## Qué ocurre en cada push

`.github/workflows/desktop.yml` se ejecuta para pushes, pull requests y de forma
manual. En todos ellos instala de cero, comprueba las specs Allium, ejecuta las
pruebas y tipos y compila la interfaz. Eso acusa recibo de cada cambio sin
convertir cada commit en software instalado automáticamente.

Sólo un tag que coincide exactamente con la versión de `package.json` abre el
circuito de distribución:

1. Windows construye NSIS y portable x64 con firma Authenticode.
2. macOS construye DMG y ZIP universales, firma con Developer ID y notariza.
3. ambos runners generan manifiestos y checksums.
4. un trabajo final reúne todo en una única GitHub Release.

Si falta cualquier credencial de firma, la release falla antes de publicar. No
se degrada silenciosamente a un instalador de «editor desconocido».

## Secretos requeridos en GitHub Actions

Windows:

- `WINDOWS_CERTIFICATE`
- `WINDOWS_CERTIFICATE_PASSWORD`

macOS:

- `MAC_CERTIFICATE`
- `MAC_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Los certificados, contraseñas y credenciales de Apple viven sólo como secretos
de Actions. Nunca se guardan en el repositorio ni dentro del instalador.

## Flujo de una actualización

La comprobación está activa únicamente en una aplicación empaquetada e
instalada de Windows o macOS. Desarrollo, Linux y la edición portable quedan
fuera.

1. Vera espera diez segundos tras arrancar para no bloquear la primera lectura.
2. Comprueba el canal estable y vuelve a hacerlo cada seis horas mientras siga
   abierta.
3. Si hay una versión nueva, informa su número y pide permiso para descargar.
4. La descarga ocurre en segundo plano y su progreso aparece en la aplicación.
5. La persona elige «Reiniciar e instalar» o «Instalar al cerrar».
6. Vera cierra primero su servidor local y SQLite; después entrega el proceso al
   actualizador.

Los errores de red no impiden usar la versión instalada. Las versiones
preliminares no entran al canal estable. La memoria permanece en su directorio:

- Windows: `%LOCALAPPDATA%\Vera`;
- macOS: `~/Library/Application Support/Vera/data`;
- Windows portable: `VeraData` junto al ejecutable.

## Crear una release

Antes del tag:

```sh
npm ci
npm run spec
npm test -- --test-concurrency=1
npm run typecheck
npm run build:desktop
npm version 0.6.3 --no-git-tag-version
npm run release:verify-tag -- v0.6.3
```

Después se revisa y compromete el cambio de versión. Crear y empujar el tag es
una operación humana deliberada; GitHub Actions hace el resto. Nunca se reutiliza
un número de versión retirado: una corrección lleva un número mayor.

## Prueba de aceptación A → B

Antes de habilitar el canal para terceros hay que demostrar en Windows 11 y en
macOS Intel/Apple Silicon que:

1. A se instala y crea una memoria;
2. A detecta B y permite aplazarla;
3. B se descarga y verifica;
4. cerrar o reiniciar instala B;
5. la misma memoria abre íntegra en B;
6. una interrupción de red deja A utilizable;
7. una release inválida o sin firma no se instala;
8. desinstalar no elimina el corpus.

La conducta observable está formalizada en
[`specs/desktop-distribution.allium`](../specs/desktop-distribution.allium). La
firma macOS y el ZIP requerido por el actualizador siguen las guías oficiales de
[notarización](https://www.electron.build/docs/notarization/) y
[actualización](https://www.electron.build/docs/features/auto-update/) de
electron-builder.
