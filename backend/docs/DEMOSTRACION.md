# Guía de demostración

Cómo mostrar, en la evaluación, que el backend cumple: **patrones de diseño**, **implementación canaria** y
**lista de endpoints ejecutada con una herramienta de pruebas de API** (Postman, curl, newman).

## 1. Requisito → evidencia

| Condición de la evaluación | Dónde se demuestra |
|---|---|
| Patrones de diseño | `docs/ARQUITECTURA_Y_CANARY.md` §2 (tabla patrón → archivo) y `npm test` (31+ pruebas: Strategy, Observer, Circuit Breaker, DI con repositorios falsos) |
| Implementación canaria | Carpeta **8** de la colección de Postman, sección 8 de `demo-curl.sh`, y `scripts/canary-eval.mjs` (decisión PROMOTE/ROLLBACK) |
| Lista de endpoints del sistema | `GET /api` (carpeta **0** de Postman), tabla de §4 de este documento |
| Ejecución con Postman/curl | `postman/CapacitacionPro.postman_collection.json` (54 requests, 90 pruebas automáticas) y `scripts/demo-curl.sh` |

## 2. Preparar el entorno (una vez)

```bash
cd backend
cp .env.example .env            # ajusta DATABASE_URL y JWT_SECRET
npm ci
npm run db:migrate              # crea/actualiza el esquema (tabla schema_migrations)
npm run db:seed                 # usuarios de demo (ver abajo)
npm run dev                     # API en http://localhost:3000
```

Usuarios de demo (contraseña `Demo1234!`, o `DEMO_PASSWORD`): `admin@alumco.cl` (admin),
`profesor@alumco.cl` (profesor), `alumno@alumco.cl` (colaborador). El seed se bloquea en producción
salvo `ALLOW_SEED=true`.

Para la parte de canary, levantar además el gateway y las dos versiones:

```bash
docker compose -f docker-compose.canary.yml up --build   # gateway :8080 · stable :3001 · canary :3002
```

## 3. Guion sugerido (≈ 8 min)

1. **Lista de endpoints** — `GET /api` (Postman, carpeta 0, o `curl localhost:3000/api`). Mostrar que se genera
   desde la misma tabla de rutas que registra Express (`src/routes/index.ts`).
2. **Flujo funcional** — correr las carpetas 1 a 6 con el *Runner*: registro → aprobación del admin → curso → examen
   (reprueba, reintenta, aprueba) → puntos/nivel/insignia → certificado verificable.
3. **Patrones en acción** — señalar en el flujo: *Observer* (aprobar el quiz suma puntos sin que el quiz conozca
   la gamificación), *Strategy* (nivel Principiante → Colaborador), *Repository/Service* (código en `repositories/` y `services/`),
   *Circuit Breaker* (`/health` muestra `circuitBreaker`).
4. **Seguridad** — carpeta 7: 401, 403, IDOR bloqueado (404), ids inválidos (400).
5. **Canary** — carpeta 8 (o sección 8 de `demo-curl.sh`):
   - reparto ≈ 90/10 entre `stable` y `canary` (header `X-Served-By`, `X-App-Version`);
   - forzar una versión con `X-Canary: <token>:canary|stable`;
   - `ranking_v2` activo solo en el canary (header `X-Ranking-Version`);
   - decisión automática: `node scripts/canary-eval.mjs` (→ PROMOTE) y, apagando la BD del canary o desplegando una
     versión defectuosa, → ROLLBACK.

## 4. Lista de endpoints (25 de negocio + 5 de sistema)

Generada con `GET /api`. Todos los endpoints de negocio cuelgan de `/api`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `POST` | `/api/auth/login` | pública | Inicia sesión y entrega el JWT (8 h) |
| `POST` | `/api/auth/register` | pública | Registra un colaborador (queda pendiente de aprobación) |
| `GET` | `/api/auth/sedes` | pública | Lista las sedes disponibles |
| `GET` | `/api/auth/me` | JWT | Datos del usuario autenticado |
| `GET` | `/api/cursos` | JWT | Cursos publicados del usuario (admin: ?all=1 lista todos) |
| `GET` | `/api/cursos/:id` | JWT | Detalle de un curso (el alumno no recibe las respuestas correctas) |
| `POST` | `/api/cursos` | JWT + rol admin o profesor | Crea un curso con sus módulos |
| `PUT` | `/api/cursos/:id` | JWT + rol admin o profesor | Edita/publica un curso (conserva el progreso de los alumnos) |
| `DELETE` | `/api/cursos/:id` | JWT + rol admin | Elimina un curso |
| `PUT` | `/api/cursos/:id/alumnos` | JWT + rol admin o profesor | Asigna alumnos a un curso |
| `POST` | `/api/quiz/:moduloId/iniciar` | JWT | Inicia un intento de examen (máx. 2, bloqueo 24 h al reprobar) |
| `POST` | `/api/quiz/:moduloId/submit` | JWT | Envía respuestas; califica y dispara puntos/insignias (Observer) |
| `GET` | `/api/quiz/:moduloId/estado` | JWT | Intentos realizados/restantes, mejor puntaje e historial |
| `GET` | `/api/gamificacion/perfil` | JWT | Puntos, nivel, racha, insignias y módulos completados |
| `POST` | `/api/gamificacion/acceso` | JWT | Registra el acceso diario y actualiza la racha |
| `GET` | `/api/gamificacion/ranking` | JWT | Ranking (?sede=...). Canary por feature flag: header X-Ranking-Version v1|v2 |
| `GET` | `/api/gamificacion/insignias` | JWT | Insignias del usuario |
| `GET` | `/api/usuarios` | JWT + rol admin | Lista todos los usuarios |
| `GET` | `/api/usuarios/perfil` | JWT | Perfil propio |
| `PUT` | `/api/usuarios/perfil` | JWT | Actualiza el perfil propio (nombre, firma) |
| `GET` | `/api/usuarios/:id` | JWT + rol admin | Detalle de un usuario |
| `PUT` | `/api/usuarios/:id` | JWT + rol admin | Aprueba cuentas, asigna roles/estado/sede |
| `POST` | `/api/certificados/generar/:cursoId` | JWT | Genera el certificado si completó todos los módulos (idempotente) |
| `GET` | `/api/certificados/verificar/:hash` | pública | Verifica un certificado por su hash (RUT enmascarado) |
| `GET` | `/api/certificados/mis-certificados` | JWT | Certificados del usuario |

Endpoints de sistema:

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/` | pública | Mensaje de bienvenida de la API |
| `GET` | `/health` | pública | Readiness: versión, track, estado de la BD y del circuit breaker (503 si la BD está caída) |
| `GET` | `/health/live` | pública | Liveness: el proceso responde (no consulta la BD) |
| `GET` | `/health/ready` | pública | Igual que /health |
| `GET` | `/metrics` | pública (o Bearer METRICS_TOKEN) | Métricas Prometheus por versión/track, base de la decisión canary |

Cuerpos de ejemplo de los endpoints con body están en la colección de Postman (cada request trae su JSON).

## 5. Ejecutar con Postman

1. *Import* → `postman/CapacitacionPro.postman_collection.json` y `postman/local.postman_environment.json`.
2. Seleccionar el environment **Alumco local** y ajustar `base_url` (por defecto `http://localhost:3000`).
3. Abrir la carpeta **0** → `Lista de endpoints del sistema` → *Send* (el detalle sale en la *Console*).
4. Botón **Run** sobre la colección: ejecuta las 9 carpetas en orden; cada request tiene pruebas (`pm.test`) y los
   tokens/ids se encadenan solos mediante variables. La carpeta 8 requiere el gateway levantado.

También por línea de comandos (el mismo motor de Postman):

```bash
npm run demo:newman                                   # usa newman (npx)
npx newman run postman/CapacitacionPro.postman_collection.json \
  -e postman/local.postman_environment.json --env-var base_url=http://localhost:3000
```

## 6. Ejecutar con curl

Flujo completo automatizado (bash + curl + node):

```bash
./scripts/demo-curl.sh http://localhost:3000 http://localhost:8080   # el segundo argumento activa la parte canary
```

Comandos sueltos (ejemplos):

```bash
curl -s localhost:3000/api | head -c 600                                    # lista de endpoints
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@alumco.cl","password":"Demo1234!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:3000/api/auth/me -H "Authorization: Bearer $TOKEN"
curl -s localhost:3000/api/usuarios -H "Authorization: Bearer $TOKEN"
curl -s -i localhost:8080/api/auth/sedes -H 'X-Canary: cambia-este-token:canary' | grep -i '^x-'   # forzar canary
```

## 7. Demostrar contra Render (sin gateway)

Las carpetas 0 a 7 y el *feature toggle* funcionan contra cualquier URL: poner `base_url` = la URL de Render.
Para mostrar el canary por funcionalidad: `FEATURE_FLAGS=ranking_v2:100` (todos ven v2) → `ranking_v2:0` (todos v1);
con un porcentaje intermedio, cada usuario cae siempre en la misma versión (`X-Ranking-Version`).
En Render el seed necesita `ALLOW_SEED=true` y solo debe usarse en una demo.
