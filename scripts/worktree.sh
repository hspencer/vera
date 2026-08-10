#!/usr/bin/env bash
#
# Un árbol de trabajo aparte, para que dos sesiones no se pisen.
#
#   ./scripts/worktree.sh <nombre> [desde]   crea ../vera-<nombre>
#   ./scripts/worktree.sh --lista
#   ./scripts/worktree.sh --retira <nombre>
#
# Existe porque trabajar dos cosas a la vez en el mismo directorio no falla
# ruidosamente: falla al confirmar. `git add -A` se lleva los archivos de la otra
# tarea, y como cada una compila con los archivos de la otra delante, nadie se
# entera hasta que alguien clona el repositorio y descubre que la rama no
# arranca. Ha pasado tres veces en este repositorio, y las tres el síntoma fue el
# mismo: un commit que importa un módulo que nunca se agregó al índice.
#
# Un worktree lo corta de raíz. Cada tarea tiene su directorio y su rama, `git
# add -A` no puede alcanzar lo que no está ahí, y juntar es un merge.
#
# Se instalan las dependencias en vez de enlazar `node_modules` del principal, y
# esa decisión es la única con algo de fondo: dentro de `node_modules` los
# paquetes del monorepo son enlaces relativos —`@vera/core -> ../../packages/core`—
# así que un `node_modules` compartido hace que el worktree pruebe el código del
# árbol principal sin decirlo. Instalar cuesta un par de segundos porque la caché
# de npm ya tiene todo, y a cambio lo que se prueba aquí es lo que hay aquí.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; RESET=''
fi
bien()  { printf '%s\n' "  ${GREEN}✓${RESET} $1"; }
mal()   { printf '%s\n' "  ${RED}✗${RESET} $1"; }
dice()  { printf '%s\n' "${BOLD}→ $1${RESET}"; }
nota()  { printf '%s\n' "    ${DIM}$1${RESET}"; }

uso() {
  cat <<'FIN'
Un árbol de trabajo aparte, para que dos sesiones no se pisen.

  ./scripts/worktree.sh <nombre> [desde]   crea ../vera-<nombre> con su rama
  ./scripts/worktree.sh --lista            los que hay
  ./scripts/worktree.sh --retira <nombre>  quita el directorio; la rama se queda

`desde` es la referencia de la que sale la rama nueva. Por omisión, HEAD.
FIN
}

case "${1:-}" in
  ''|-h|--help|--ayuda) uso; exit 0 ;;
  --lista) git worktree list; exit 0 ;;
  --retira)
    NOMBRE="${2:-}"
    [ -n "$NOMBRE" ] || { mal 'falta el nombre'; exit 1; }
    DONDE="../vera-$NOMBRE"
    [ -d "$DONDE" ] || { mal "no hay ningún $DONDE"; exit 1; }
    # Sin --force: si quedan cambios sin confirmar, git se planta, y hace bien.
    # Retirar un árbol con trabajo dentro es exactamente lo que esto evita.
    git worktree remove "$DONDE"
    bien "retirado $DONDE"
    nota 'la rama sigue existiendo: `git branch -d <rama>` cuando ya esté fundida'
    exit 0
    ;;
esac

NOMBRE="$1"
DESDE="${2:-HEAD}"
DONDE="../vera-$NOMBRE"

# La rama hereda la línea de versión de la actual: `v0.3-frontera` da `v0.3-…`,
# que es cómo se nombran las ramas aquí. Fuera de esa forma, el nombre a secas.
ACTUAL="$(git branch --show-current 2>/dev/null || echo '')"
if [[ "$ACTUAL" =~ ^(v[0-9]+(\.[0-9]+)?)- ]]; then
  RAMA="${BASH_REMATCH[1]}-$NOMBRE"
else
  RAMA="$NOMBRE"
fi

if [ -e "$DONDE" ]; then
  mal "ya existe $DONDE"
  exit 1
fi
if git show-ref --verify --quiet "refs/heads/$RAMA"; then
  mal "la rama $RAMA ya existe"
  nota "elige otro nombre, o sácale un worktree con: git worktree add $DONDE $RAMA"
  exit 1
fi

dice "un árbol aparte en $DONDE, sobre la rama $RAMA"

# Lo que está sin confirmar aquí no viaja: un worktree sale de un commit. Decirlo
# antes evita el «¿dónde está mi trabajo?» de dentro de dos minutos.
SUCIO="$(git status --porcelain | wc -l)"
if [ "$SUCIO" -gt 0 ]; then
  nota "aquí quedan $SUCIO archivos sin confirmar; no viajan, la rama nueva sale de $DESDE"
fi

git worktree add "$DONDE" -b "$RAMA" "$DESDE" >/dev/null
bien "creado sobre $(git rev-parse --short "$DESDE")"

dice 'instalando dependencias'
( cd "$DONDE" && npm install --silent )

# Y la comprobación que justifica haber instalado en vez de enlazar: que los
# paquetes del monorepo apunten aquí dentro y no al árbol principal. Si esto
# falla, todo lo que se pruebe ahí estará probando otro código.
PROPIO="$(cd "$DONDE" && readlink -f node_modules/@vera/core 2>/dev/null || echo '')"
ESPERADO="$(cd "$DONDE" && pwd -P)/packages/core"
if [ "$PROPIO" = "$ESPERADO" ]; then
  bien 'los paquetes del monorepo resuelven dentro de este árbol'
else
  mal 'los paquetes del monorepo NO resuelven aquí dentro'
  nota "@vera/core apunta a ${PROPIO:-nada}"
  nota 'lo que se pruebe ahí no será lo que hay ahí; revisa antes de seguir'
  exit 1
fi

cat <<FIN

  ${BOLD}cd $DONDE${RESET}

  Ahí dentro vale todo lo que no publica: ${BOLD}make check${RESET}, ${BOLD}npm test${RESET}, ${BOLD}npm run build${RESET}.

  ${DIM}Lo que no vale es levantar un segundo servidor. El corpus es uno y vive en el
  árbol principal: dos procesos con su propio grafo en memoria sobre la misma
  base acabarían escribiendo cada uno sobre lo que el otro no vio. Sin \`.env\`,
  \`npm run serve\` se planta ahí antes que inventar un grafo sin dueño, que es
  la respuesta correcta.${RESET}

  Para juntar, desde el principal: ${BOLD}git merge $RAMA${RESET}
  Para retirarlo:                  ${BOLD}./scripts/worktree.sh --retira $NOMBRE${RESET}
FIN
