#!/usr/bin/env bash
# Smoke HTTP de un ambiente publicado (docs/PLAN_AMBIENTES.md, D.3 y P-7). Lo usa deploy.yml después de
# publicar; no escribe nada. Comprueba que el sitio sirve exactamente el build de este run:
#   - las cuatro páginas responden 200;
#   - cada archivo de huellas.txt (las páginas, los .js, los .css y el resto de dist/) servido tiene su huella;
#   - los .js servidos contienen el projectId del ambiente;
#   - con --noindex, la respuesta trae X-Robots-Tag: noindex (solo QA; GitHub Pages no admite cabeceras).
# Uso: scripts/ci/smoke.sh <url-del-sitio/> <projectId> [--noindex]   (desde la raíz, con huellas.txt)
set -euo pipefail

SITE_URL="${1:?Falta la URL del sitio}"
PROJECT_ID="${2:?Falta el projectId esperado}"
NOINDEX="${3:-}"
SITE_URL="${SITE_URL%/}/"

# La CDN puede tardar unos segundos en servir la versión nueva: index.html se reintenta hasta que tenga la
# huella del build (máximo 2 minutos).
esperada=$(awk '$2 == "dist/index.html" { print $1 }' huellas.txt)
for intento in $(seq 1 12); do
  servida=$(curl -fsS --compressed "${SITE_URL}index.html" | sha256sum | cut -d' ' -f1 || true)
  [ "$servida" = "$esperada" ] && break
  echo "Intento ${intento}: index.html aún no es el de este build; espero 10 s."
  sleep 10
done
[ "$servida" = "$esperada" ] || { echo "::error::${SITE_URL}index.html no tiene la huella de este build."; exit 1; }

for page in index.html tablero.html login.html usuarios.html; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${SITE_URL}${page}")
  [ "$code" = "200" ] || { echo "::error::${page} respondió ${code}."; exit 1; }
done

proyecto_encontrado=no
while read -r hash ruta; do
  archivo="${ruta#dist/}"
  servido=$(mktemp)
  curl -fsS --compressed --retry 3 --retry-delay 5 -o "$servido" "${SITE_URL}${archivo}" \
    || { echo "::error::${archivo} no se pudo descargar."; exit 1; }
  [ "$(sha256sum "$servido" | cut -d' ' -f1)" = "$hash" ] \
    || { echo "::error::${archivo} servido no tiene la huella de este build."; exit 1; }
  if [[ "$archivo" == *.js ]] && grep -q "$PROJECT_ID" "$servido"; then proyecto_encontrado=si; fi
  rm -f "$servido"
done < huellas.txt
[ "$proyecto_encontrado" = "si" ] || { echo "::error::Ningún .js servido contiene ${PROJECT_ID}."; exit 1; }

if [ "$NOINDEX" = "--noindex" ]; then
  curl -fsSI "${SITE_URL}" | grep -qi '^x-robots-tag: *noindex' \
    || { echo "::error::${SITE_URL} no responde con X-Robots-Tag: noindex."; exit 1; }
fi

echo "✔ Smoke: ${SITE_URL} sirve este build ($(wc -l < huellas.txt | tr -d ' ') archivos con su huella) y usa ${PROJECT_ID}."
