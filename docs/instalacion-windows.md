# Instalación de Vera en Windows

Estado: primer prototipo empaquetable. Todavía no es una versión alfa para
personas externas.

## Artefactos

- `Vera Setup <versión>.exe`: instalación por persona mediante NSIS. El corpus
  queda fuera del programa y el desinstalador no lo elimina.
- `Vera <versión>.exe`: edición portable. Crea `VeraData` junto al ejecutable.

Ambos contienen el mismo payload: Electron, el servidor local de Vera, la
interfaz web compilada, el esquema SQLite y los recursos de presentación.

## Primera apertura

Si no existe una memoria, Vera pide el nombre de la persona propietaria. No lo
deduce de Windows: esa identidad firma las futuras contribuciones humanas y
debe ser una declaración consciente.

Después crea una memoria inicial versionada con siete páginas:

1. `Vera`, portada y orientación;
2. `Vera — Primeros pasos`;
3. `Vera — Manual`;
4. `Vera — Teclado y atajos`;
5. `Vera — Página de ejemplo`;
6. `Vera — Conectar una inteligencia artificial`;
7. `Vera — Principios`.

Estas páginas no se copian desde una base binaria. Son operaciones canónicas,
idempotentes y auditables firmadas por `participant:vera-distribution`. La
persona puede editarlas o borrarlas; reiniciar Vera no las recrea.

## Datos

- Instalación normal: `%LOCALAPPDATA%\Vera`.
- Portable: `VeraData` junto al ejecutable.

El programa es reemplazable. La base SQLite, los objetos y la configuración no
forman parte del paquete ni deben borrarse al actualizar o desinstalar.

## Construir

```sh
npm ci
npm run build:desktop
npm run pack:windows
```

Alexei puede compilar el payload y producir el portable x64 directamente desde
Debian. NSIS necesita Wine cuando se construye localmente en Linux. La vía
reproducible principal es `.github/workflows/windows.yml`, sobre un runner
Windows de GitHub Actions; un tag `v*` construye, calcula checksums y crea el
GitHub Release.

## Pendiente antes del alfa

- probar instalación, primera apertura, reinicio y desinstalación en Windows 11
  limpio;
- diseñar icono y metadatos finales;
- firma Authenticode y secretos protegidos del workflow;
- respaldo previo y prueba de migración entre dos versiones;
- implementar el cliente de actualización y su experiencia de aplazamiento;
- diagnóstico exportable sin secretos;
- medir arranque, RAM y corpus grandes en el hardware mínimo declarado.
