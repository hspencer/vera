#!/usr/bin/env bash
#
# Medida consultiva de autoría. NO decide nada.
#
# Produce tres cuentas por persona y se niega a colapsarlas en un número, porque
# no son la misma cosa: un commit es un acto, una línea viva es materia que
# sobrevivió, y una spec tocada es una decisión de comportamiento. Un promedio
# de las tres sería una cuarta cifra que no mide nada y que, por venir de un
# script, parecería objetiva.
#
# AUTHORS.md registra la autoría; estas medidas sólo informan esa conversación.
#
#   ./scripts/autoria.sh              # sobre HEAD
#   ./scripts/autoria.sh v0.3.0       # sobre una referencia
#
set -euo pipefail

REF="${1:-HEAD}"
cd "$(git rev-parse --show-toplevel)"

# Lo que cuenta como obra. Se excluye todo lo generado, lo ajeno y lo que no es
# texto: contar un package-lock.json es contar el trabajo de npm.
mapfile -t FILES < <(
  git ls-tree -r --name-only "$REF" \
  | grep -E '^(packages|specs|scripts|schema|docs)/|^[^/]+\.(md|json|ts|sh)$|^Makefile$' \
  | grep -vE '(^|/)(node_modules|dist)/' \
  | grep -vE 'package-lock\.json$' \
  | grep -vE '\.(svg|png|jpg|jpeg|webp|woff2?|ico|sqlite)$'
)

printf '\n  Medida consultiva de autoría — %s (%s)\n' "$REF" "$(git rev-parse --short "$REF")"
printf '  %d archivos considerados\n\n' "${#FILES[@]}"

# ── 1. Commits ────────────────────────────────────────────────────────────────
# Un acto de trabajo, con su fecha y su mensaje. Mide ritmo y presencia, no peso:
# un commit puede ser una coma o un subsistema.
printf '  \033[1mCommits\033[0m — actos de trabajo\n'
git shortlog -sn --no-merges "$REF" | sed 's/^/    /'
printf '\n'

# ── 2. Líneas vivas ───────────────────────────────────────────────────────────
# Lo que sobrevivió hasta hoy, atribuido por blame. Es la cuenta menos injusta
# con quien mantiene y la más injusta con quien borró bien: quitar mil líneas
# que sobraban no aparece aquí, y suele ser el mejor trabajo del trimestre.
printf '  \033[1mLíneas vivas\033[0m — materia que sobrevivió, por blame\n'
for f in "${FILES[@]}"; do
  git blame --line-porcelain -w -M -C "$REF" -- "$f" 2>/dev/null | grep '^author '
done \
  | sed 's/^author //' \
  | sort | uniq -c | sort -rn \
  | awk '{ n=$1; $1=""; sub(/^ /,""); a[NR]=$0; c[NR]=n; t+=n }
         END { for (i=1;i<=NR;i++) printf "    %7d  %5.1f%%  %s\n", c[i], 100*c[i]/t, a[i] }'
printf '\n'

# ── 3. Especificaciones ───────────────────────────────────────────────────────
# En este repositorio el comportamiento se decide en specs/ y después se
# implementa. Quien escribe una spec decide qué hace Vera; quien la implementa
# decide cómo. Las dos cosas son autoría y no son la misma.
printf '  \033[1mEspecificaciones\033[0m — decisiones de comportamiento\n'
git log --no-merges --format='%an' --name-only "$REF" -- 'specs/*.allium' \
  | awk 'NF && !/\.allium$/ { who=$0; next } /\.allium$/ { seen[who"\t"$0]=1 }
         END { for (k in seen) { split(k,p,"\t"); n[p[1]]++ }
               for (w in n) printf "    %7d  %s\n", n[w], w }' \
  | sort -rn
printf '\n'

cat <<'FIN'
  Estas cifras no reparten nada. Lo que reparte es AUTHORS.md, y lo que lo
  escribe es una conversación entre quienes figuran en él.

  Lo que ninguna de las tres columnas ve: revisar el trabajo de otro, encontrar
  el defecto que nadie veía, borrar lo que sobraba, elicitar un requisito,
  sostener la decisión difícil, o escribir la línea corta que resolvió la
  semana. Todo eso es autoría y no deja rastro contable.
FIN
