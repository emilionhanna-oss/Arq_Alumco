# CapacitaciónPro — API

Backend de CapacitaciónPro (ONG Alumco): Node 20 + Express + TypeScript + PostgreSQL.

## Puesta en marcha

```bash
cp .env.example .env            # JWT_SECRET es obligatorio en producción
npm ci
npm run db:migrate              # migraciones versionadas (tabla schema_migrations)
npm run db:seed                 # usuarios de demo (solo desarrollo)
npm run dev                     # http://localhost:3000
npm test                        # TEST_DATABASE_URL=postgresql://... para incluir integración
npm run build && npm start
```

Usuarios de demo (contraseña `Demo1234!`): `admin@alumco.cl`, `profesor@alumco.cl`, `alumno@alumco.cl`.

## Endpoints

La lista también se obtiene en vivo con `GET /api` (se genera desde la misma tabla de rutas que registra Express).
Todos los endpoints de negocio cuelgan de `/api`. Autenticación: header `Authorization: Bearer <token>`.

### Autenticación

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `POST` | `/api/auth/login` | pública | Inicia sesión y entrega el JWT (8 h) |
| `POST` | `/api/auth/register` | pública | Registra un colaborador (queda pendiente de aprobación) |
| `GET` | `/api/auth/sedes` | pública | Lista las sedes disponibles |
| `GET` | `/api/auth/me` | JWT | Datos del usuario autenticado |

### Cursos

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/api/cursos` | JWT | Cursos publicados del usuario (admin: `?all=1` lista todos) |
| `GET` | `/api/cursos/:id` | JWT | Detalle de un curso (el alumno no recibe las respuestas correctas) |
| `POST` | `/api/cursos` | JWT + rol admin o profesor | Crea un curso con sus módulos |
| `PUT` | `/api/cursos/:id` | JWT + rol admin o profesor | Edita/publica un curso (conserva el progreso de los alumnos) |
| `DELETE` | `/api/cursos/:id` | JWT + rol admin | Elimina un curso |
| `PUT` | `/api/cursos/:id/alumnos` | JWT + rol admin o profesor | Asigna alumnos a un curso |

### Exámenes

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `POST` | `/api/quiz/:moduloId/iniciar` | JWT | Inicia un intento (máx. 2, bloqueo 24 h al reprobar) |
| `POST` | `/api/quiz/:moduloId/submit` | JWT | Envía respuestas; califica y dispara puntos/insignias |
| `GET` | `/api/quiz/:moduloId/estado` | JWT | Intentos realizados/restantes, mejor puntaje e historial |

### Gamificación

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/api/gamificacion/perfil` | JWT | Puntos, nivel, racha, insignias y módulos completados |
| `POST` | `/api/gamificacion/acceso` | JWT | Registra el acceso diario y actualiza la racha |
| `GET` | `/api/gamificacion/ranking` | JWT | Ranking (`?sede=...`). Header `X-Ranking-Version`: v1 o v2 (canary por feature flag) |
| `GET` | `/api/gamificacion/insignias` | JWT | Insignias del usuario |

### Usuarios

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/api/usuarios` | JWT + rol admin | Lista todos los usuarios |
| `GET` | `/api/usuarios/perfil` | JWT | Perfil propio |
| `PUT` | `/api/usuarios/perfil` | JWT | Actualiza el perfil propio (nombre, firma) |
| `GET` | `/api/usuarios/:id` | JWT + rol admin | Detalle de un usuario |
| `PUT` | `/api/usuarios/:id` | JWT + rol admin | Aprueba cuentas, asigna roles/estado/sede |

### Certificados

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `POST` | `/api/certificados/generar/:cursoId` | JWT | Genera el certificado si completó todos los módulos (idempotente) |
| `GET` | `/api/certificados/verificar/:hash` | pública | Verifica un certificado por su hash (RUT enmascarado) |
| `GET` | `/api/certificados/mis-certificados` | JWT | Certificados del usuario |

### Sistema

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/api` | pública | Lista de endpoints (JSON) |
| `GET` | `/` | pública | Mensaje de bienvenida |
| `GET` | `/health` | pública | Readiness: versión, track, estado de la BD y del circuit breaker (503 si la BD cae) |
| `GET` | `/health/live` | pública | Liveness: el proceso responde (no consulta la BD) |
| `GET` | `/health/ready` | pública | Igual que `/health` |
| `GET` | `/metrics` | pública (o Bearer `METRICS_TOKEN`) | Métricas Prometheus por versión/track |

Total: 25 endpoints de negocio + 5 de sistema (más `GET /api`).

## Más documentación

- Patrones de diseño y despliegue canario: [docs/ARQUITECTURA_Y_CANARY.md](docs/ARQUITECTURA_Y_CANARY.md)
- Demostración (guion, Postman, curl, canary): [docs/DEMOSTRACION.md](docs/DEMOSTRACION.md)
- Despliegue en AWS (DynamoDB + Cognito): [docs/CONTEXTO_DESPLIEGUE_AWS.md](docs/CONTEXTO_DESPLIEGUE_AWS.md) — diseño y plan; aún no implementado.
