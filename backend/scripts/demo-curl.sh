#!/usr/bin/env bash
# Demostración con curl del flujo completo + canary.
#   ./scripts/demo-curl.sh [BASE_URL] [GATEWAY_URL]
#   ./scripts/demo-curl.sh http://localhost:3000 http://localhost:8080
# Requisitos: bash, curl y node (se usa solo para leer JSON). Usuarios: ver `npm run db:seed`.
set -uo pipefail
BASE="${1:-http://localhost:3000}"; GW="${2:-}"
PASS="${DEMO_PASSWORD:-Demo1234!}"; CANARY_TOKEN="${CANARY_FORCE_TOKEN:-cambia-este-token}"
FALLOS=0; TMP="$(mktemp)"
# jget '<expr sobre j>' < json   ->   p.ej.  jget 'j.token'
jget() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const v=($1);console.log(typeof v==='object'?JSON.stringify(v):v)})"; }
paso() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }
# call ESPERADO METODO URL [TOKEN] [BODY] [HEADER-EXTRA]  -> deja el cuerpo en $TMP y el código en $CODE
call() {
  local esperado="$1" metodo="$2" url="$3" token="${4:-}" body="${5:-}" extra="${6:-}"
  local args=(-s -o "$TMP" -D "$TMP.h" -w '%{http_code}' -X "$metodo" "$url")
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ]  && args+=(-H 'Content-Type: application/json' -d "$body")
  [ -n "$extra" ] && args+=(-H "$extra")
  CODE=$(curl "${args[@]}")
  local marca='\033[32mOK \033[0m'; [ "$CODE" != "$esperado" ] && { marca='\033[31mFALLA\033[0m'; FALLOS=$((FALLOS+1)); }
  printf "  $marca %-6s %-58s -> HTTP %s (esperado %s)\n" "$metodo" "${url#"$BASE"}" "$CODE" "$esperado"
}
hdr() { grep -i "^$1:" "$TMP.h" | tr -d '\r' | cut -d' ' -f2-; }
val() { jget "$1" < "$TMP"; }

paso "0. Lista de endpoints del sistema"
call 200 GET "$BASE/api"
node -e "const j=JSON.parse(require('fs').readFileSync('$TMP','utf8'));console.log('  '+j.api+' v'+j.version+' ['+j.track+'] — '+j.totalEndpointsNegocio+' endpoints de negocio');for(const e of j.endpoints)console.log('  '+e.metodo.padEnd(7)+e.ruta.padEnd(40)+e.acceso)"
call 200 GET "$BASE/health"; echo "  $(cat "$TMP")"

paso "1. Autenticación"
call 200 POST "$BASE/api/auth/login" "" "{\"email\":\"admin@alumco.cl\",\"password\":\"$PASS\"}";    ADMIN=$(val 'j.token')
call 200 POST "$BASE/api/auth/login" "" "{\"email\":\"profesor@alumco.cl\",\"password\":\"$PASS\"}"; PROF=$(val 'j.token')
EMAIL="demo.$(date +%s)@alumco.cl"; RUT="$(( (RANDOM % 80000000) + 10000000 ))-K"
call 201 POST "$BASE/api/auth/register" "" "{\"nombreCompleto\":\"Carla Demo\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"confirmPassword\":\"$PASS\",\"genero\":\"femenino\",\"sede\":\"Hualpen (Region del Biobio)\",\"rut\":\"$RUT\",\"cargo\":\"TENS\"}"
call 403 POST "$BASE/api/auth/login" "" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"; echo "  mensaje: $(val 'j.mensaje')"

paso "2. El admin aprueba la cuenta"
call 200 GET "$BASE/api/usuarios" "$ADMIN"; NUEVO_ID=$(val "j.find(u=>u.email==='$EMAIL').id")
call 200 PUT "$BASE/api/usuarios/$NUEVO_ID" "$ADMIN" '{}'; echo "  estado: $(val 'j.usuario.estado')"
call 200 POST "$BASE/api/auth/login" "" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"; ALUMNO=$(val 'j.token')

paso "3. Cursos: el profesor crea, publica y asigna"
QUIZ='[{"tituloModulo":"Evaluación","tipo":"quiz","contenido":[{"pregunta":"2+2","opciones":[{"texto":"3","correcta":false},{"texto":"4","correcta":true}]},{"pregunta":"Capital de Chile","opciones":[{"texto":"Santiago","correcta":true},{"texto":"Lima","correcta":false}]}]}]'
call 201 POST "$BASE/api/cursos" "$PROF" "{\"titulo\":\"Seguridad en ELEAM\",\"descripcion\":\"Demo\",\"modulos\":$QUIZ}"; CURSO=$(val 'j.curso.id'); MOD=$(val 'j.curso.modulos[0].id')
call 200 PUT "$BASE/api/cursos/$CURSO" "$PROF" '{"publicado":true}'
call 200 PUT "$BASE/api/cursos/$CURSO/alumnos" "$PROF" "{\"alumnosInscritos\":[$NUEVO_ID]}"
call 200 GET "$BASE/api/cursos/$CURSO" "$ALUMNO"
grep -q correcta "$TMP" && { echo "  ✗ el alumno ve las respuestas correctas"; FALLOS=$((FALLOS+1)); } || echo "  ✓ el alumno NO recibe las respuestas correctas"

paso "4. Examen: reprobar, reintentar y aprobar"
call 201 POST "$BASE/api/quiz/$MOD/iniciar" "$ALUMNO" '{}'; I1=$(val 'j.intentoId')
call 200 POST "$BASE/api/quiz/$MOD/submit" "$ALUMNO" "{\"intentoId\":$I1,\"respuestas\":[0,1]}"; echo "  puntaje: $(val 'j.puntaje') aprobado: $(val 'j.aprobado')"
call 409 POST "$BASE/api/quiz/$MOD/submit" "$ALUMNO" "{\"intentoId\":$I1,\"respuestas\":[1,0]}"
call 201 POST "$BASE/api/quiz/$MOD/iniciar" "$ALUMNO" '{}'; I2=$(val 'j.intentoId')
call 404 POST "$BASE/api/quiz/$MOD/submit" "$PROF" "{\"intentoId\":$I2,\"respuestas\":[1,0]}"   # IDOR bloqueado
call 200 POST "$BASE/api/quiz/$MOD/submit" "$ALUMNO" "{\"intentoId\":$I2,\"respuestas\":[1,0]}"; echo "  puntaje: $(val 'j.puntaje') aprobado: $(val 'j.aprobado')"

paso "5. Gamificación (Observer + Strategy)"
call 200 POST "$BASE/api/gamificacion/acceso" "$ALUMNO" '{}'; echo "  racha: $(val 'j.rachaDias')"
call 200 GET "$BASE/api/gamificacion/perfil" "$ALUMNO"; echo "  $(val '({puntos:j.puntos,nivel:j.nivel,insignias:j.insignias})')"

paso "6. Certificado"
call 201 POST "$BASE/api/certificados/generar/$CURSO" "$ALUMNO" '{}'; HASH=$(val 'j.certificado.hash')
call 200 GET "$BASE/api/certificados/verificar/$HASH"; echo "  $(val '({valido:j.valido,rut:j.rut})')"
call 200 GET "$BASE/api/gamificacion/perfil" "$ALUMNO"; echo "  tras el certificado: $(val '({puntos:j.puntos,nivel:j.nivel})')"

paso "7. Seguridad"
call 401 GET "$BASE/api/cursos"
call 403 GET "$BASE/api/usuarios" "$ALUMNO"
call 403 DELETE "$BASE/api/cursos/$CURSO" "$PROF"
call 400 GET "$BASE/api/cursos/abc" "$ADMIN"

if [ -n "$GW" ]; then
  paso "8. Canary a través del gateway ($GW)"
  declare -A N=()
  for i in $(seq 1 100); do
    call 200 GET "$GW/api/auth/sedes" "" "" "X-Forwarded-For: 10.9.$((i/250)).$((i%250))" >/dev/null
    k="$(hdr X-App-Track) ($(hdr X-App-Version))"; N[$k]=$(( ${N[$k]:-0} + 1 ))
  done
  echo "  Reparto de 100 clientes distintos:"; for k in "${!N[@]}"; do echo "    ${N[$k]}  $k"; done
  call 200 GET "$GW/api/auth/sedes" "" "" "X-Canary: $CANARY_TOKEN:canary"; echo "  forzado canary -> X-Served-By: $(hdr X-Served-By), versión $(hdr X-App-Version)"
  call 200 GET "$GW/api/auth/sedes" "" "" "X-Canary: $CANARY_TOKEN:stable"; echo "  forzado stable -> X-Served-By: $(hdr X-Served-By), versión $(hdr X-App-Version)"
  call 200 GET "$GW/api/gamificacion/ranking" "$ALUMNO" "" "X-Canary: $CANARY_TOKEN:canary"; echo "  ranking en canary -> X-Ranking-Version: $(hdr X-Ranking-Version)"
  call 200 GET "$GW/api/gamificacion/ranking" "$ALUMNO" "" "X-Canary: $CANARY_TOKEN:stable"; echo "  ranking en stable -> X-Ranking-Version: $(hdr X-Ranking-Version)"
fi

rm -f "$TMP" "$TMP.h"
printf '\n'; [ "$FALLOS" -eq 0 ] && printf '\033[1;32mTodo correcto.\033[0m\n' || { printf '\033[1;31m%s verificación(es) fallaron.\033[0m\n' "$FALLOS"; exit 1; }
