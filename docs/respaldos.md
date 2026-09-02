# Respaldos de Vera

La base viva `data/vera.sqlite` no se copia directamente. `npm run backup:data`
usa la API de backup en línea de SQLite, comprueba la integridad de la copia y
la entrega a un repositorio cifrado de restic. Restic fragmenta y deduplica los
snapshots: las ejecuciones posteriores conservan los bloques nuevos o cambiados
en vez de añadir otra base completa.

En Alexei el repositorio está fuera del proyecto, en
`~/.local/share/vera-backups/restic`, y su contraseña está cifrada como
credencial de usuario `~/.openclaw/credentials/vera-restic.cred`. Ninguno de los
dos se versiona. La retención automática conserva siete diarios, cuatro
semanales y seis mensuales.

El temporizador de usuario `vera-backup.timer` ejecuta el respaldo cada día. Se
puede comprobar con:

```sh
systemctl --user status vera-backup.timer
journalctl --user -u vera-backup.service
```

Este repositorio local protege contra errores humanos y reduce el espacio, pero
no contra la pérdida física de Alexei. El siguiente nivel debe copiar el mismo
repositorio restic a almacenamiento externo cifrado o adoptar réplica continua
fuera de la máquina.

