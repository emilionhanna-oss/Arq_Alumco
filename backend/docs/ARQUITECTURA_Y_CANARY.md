# Backend CapacitaciónPro — patrones de diseño y despliegue canario

Backend desplegado: `backend/` (Node 20 + Express 4 + TypeScript + PostgreSQL). Este documento resume qué patrones
contiene, dónde está cada uno, cómo se hace el despliegue canario y cómo verificarlo.

## 1. Arquitectura en capas

```
HTTP ─► routes ─► middleware (auth, roles, errores, métricas, versión)
                     │
                 controllers          (delgados: HTTP <-> servicio, sin SQL ni reglas)
                     │
                  services            (reglas de negocio: Auth, Curso, Quiz, Gamificación, Certificado, Usuario)
                  │      ▲
        publica   │      │ observa
        eventos ──▼──────┴── EventBus ──► subscribers/gamificacionSubscriber
                     │
              repositories/contracts  (interfaces)  ◄── repositories/pg/*  (implementación PostgreSQL)
                     │
              db/Database (interfaz)  ◄── PgDatabase  ◄── Circuit Breaker (opossum) ◄── pg.Pool
```

`container.ts` es el único lugar que conoce las clases concretas y las conecta (composition root).

## 2. Patrones: dónde está cada uno

| Patrón | Tipo | Archivo(s) | Qué resuelve |
|---|---|---|---|
| **Repository** | Arquitectónico | `repositories/contracts.ts`, `repositories/pg/*` | Saca todo el SQL de los controladores; los servicios dependen de interfaces |
| **Service Layer** | Arquitectónico | `services/*` | Reglas de negocio fuera de HTTP y fuera de SQL |
| **Inyección de dependencias** | Arquitectónico | constructores de servicios, `container.ts`, `middleware/auth.ts` | Permite probar con repositorios en memoria (`test/servicios.test.ts`) |
| **Strategy** | GoF (comportamiento) | `domain/nivel.ts` (`NivelStrategy`, `UmbralNivelStrategy`) | Cómo se calcula el rango a partir de puntos; intercambiable |
| **Observer** | GoF (comportamiento) | `domain/events.ts`, `subscribers/gamificacionSubscriber.ts` | Quiz y certificados publican hechos; la gamificación reacciona (puntos, insignias, racha) |
| **Singleton** (explícito) | GoF (creación) | `PgDatabase` creada una sola vez en `index.ts`/`container.ts` | Una única conexión/pool/breaker por proceso, no por accidente del caché de módulos |
| **Factory / Composition Root** | GoF-like (creación) | `container.ts` (`buildContainer`), `controllers/index.ts` (`buildControllers`), `routes/index.ts` (`buildRouter`), `requireAuth(...)`/`requireRole(...)` | Construcción centralizada de objetos y middleware parametrizados |
| **Circuit Breaker** | Resiliencia | `db/Database.ts` (opossum) | Si la BD cae, falla rápido con 503 en lugar de acumular peticiones colgadas; solo fallos de infraestructura cuentan |
| **Chain of Responsibility / Middleware** | Nativo de Express | `middleware/*` | auth → rol → controlador → manejo de errores |
| **DTO / Mapper** | Arquitectónico | `mappers.ts` | Contrato JSON único (antes `buildUser` y `buildUsuario` estaban duplicados) |
| **Feature Toggle** | Despliegue | `canary/featureFlags.ts` | Canary por funcionalidad (ver §3) |

## 3. Despliegue canario

Hay dos niveles, complementarios:

### 3.1 Canary de infraestructura (versión completa del backend)

```
cliente ─► gateway (nginx) ──90%──► backend-stable  (APP_TRACK=stable, v1.0.0)
                           └─10%──► backend-canary  (APP_TRACK=canary, v1.1.0)
                                          │ ambos ► misma PostgreSQL
```

- **Reparto sticky por cliente** (`split_clients` sobre IP + User-Agent): el mismo cliente siempre cae en el mismo
  lado; subir el porcentaje solo agrega clientes. Se configura con `CANARY_PERCENT`.
- **Forzado manual para QA**: header `X-Canary: <CANARY_FORCE_TOKEN>:canary` (o `:stable`).
- **Red de seguridad**: si el canary responde 502/503/504, las lecturas (GET/HEAD) se reintentan en stable.
  Las escrituras no se reintentan (evita duplicar efectos).
- **Identificación**: cada respuesta lleva `X-App-Version`, `X-App-Track` y `X-Served-By`.
- **Observabilidad**: `/metrics` (formato Prometheus) por instancia con peticiones por clase de estado, histograma de
  latencia y estado del circuit breaker, etiquetado por versión/track.
- **Decisión automática**: `node scripts/canary-eval.mjs` compara canary vs stable y termina con código
  `0 = PROMOTE`, `1 = ROLLBACK`, `2 = WAIT` (utilizable como paso de pipeline).
- **Salud**: `/health/live` (proceso vivo, no toca la BD) y `/health/ready` o `/health` (BD ok y no apagándose).
- **Apagado ordenado**: con SIGTERM la instancia pasa a no-ready (503), termina lo en curso y cierra el pool.

Demo local:

```bash
docker compose -f docker-compose.canary.yml up --build        # gateway en :8080, stable :3001, canary :3002
node scripts/canary-traffic.mjs --url http://localhost:8080 --n 1000   # ver el reparto 90/10
node scripts/canary-eval.mjs --stable http://localhost:3001 --canary http://localhost:3002
# subir el canary: CANARY_PERCENT=25 docker compose -f docker-compose.canary.yml up -d gateway
# revertir:        CANARY_PERCENT=0  docker compose -f docker-compose.canary.yml up -d gateway
```

Para un canary real, construir la versión nueva desde su propia rama (`CANARY_CONTEXT=../worktree-nueva CANARY_VERSION=1.2.0`).

### 3.2 Canary de funcionalidad (feature toggle por porcentaje)

`FEATURE_FLAGS=ranking_v2:10` activa la versión v2 del ranking (consulta sin `GROUP BY`, desempate determinista) para
el 10 % de los usuarios, con bucket estable por usuario (`sha256(flag:usuarioId) % 100`). Para revertir basta
`ranking_v2:0`. La respuesta incluye `X-Ranking-Version: v1|v2`. Este nivel **no necesita gateway ni segunda
instancia**, por lo que funciona tal cual en un único servicio de Render (cambiar la variable de entorno y reiniciar).

### 3.3 Migraciones compatibles con canary

Stable y canary comparten base de datos, así que las migraciones (`db/migrations.ts`, tabla `schema_migrations`,
con advisory lock) siguen **expand/contract**: primero solo se agregan tablas/columnas/índices (compatibles con
ambas versiones); los `DROP`/`RENAME` van en una migración posterior, cuando la versión vieja ya no existe.
Se ejecutan una vez antes de desplegar (`npm run db:migrate:prod`).

## 4. Errores corregidos (reproducidos contra el backend original)

| # | Problema en el original | Evidencia | Ahora |
|---|---|---|---|
| 1 | `submitQuiz` insertaba en `respuestas_quiz`, tabla que `migrate.ts` nunca creaba | el submit devolvía 500 **después** de cerrar el intento y dar puntos | migración `002`; guardado atómico en transacción |
| 2 | Editar un curso hacía `DELETE FROM modulos` + reinsertar (con `ON DELETE CASCADE`) | progreso de los alumnos: **2 → 0** tras editar | los módulos se actualizan en el lugar (por `id` o posición); solo se borran los quitados |
| 3 | `submitQuiz` actualizaba el intento solo por `id` (IDOR) | una alumna cerró el intento de otra, recibió 500 y se llevó los 100 puntos | verifica pertenencia (404), módulo (400) y estado (409) |
| 4 | `GET /cursos/:id` devolvía `correcta: true` al alumno | el alumno veía las respuestas del examen | solo staff las recibe |
| 5 | Certificados sumaban puntos sin recalcular el nivel | 300 pts seguían en "Principiante" | un único `sumarPuntos` recalcula siempre |
| 6 | Primer acceso: racha quedaba en 0 | `rachaDias = 0` | `calcularRacha` → 1 |
| 7 | Hash de certificado = sha256(usuario-curso-timestamp) | reproducible por fuerza bruta | 256 bits aleatorios |
| 8 | Verificación pública de certificado devolvía el RUT completo | — | RUT enmascarado (`*****678-5`); si el front lo necesita completo, es un cambio de una línea en `CertificadoService.verificar` |
| 9 | N+1 en `listarCursos` y `listarUsuarios` | 2 consultas extra por curso / 1 por usuario | 1 consulta por colección |
| 10 | `JWT_SECRET` caía a un secreto público | — | en producción el servidor no arranca sin él |
| 11 | Ids no numéricos / violaciones de FK → 500 | — | 400/409 |

## 5. Pruebas

`npm test` → 33 pruebas (dominio, circuit breaker, servicios con fakes, y 14 de integración HTTP contra PostgreSQL real
si se define `TEST_DATABASE_URL`). `npm run typecheck` valida también los tests.

## 6. Fuera de alcance / pendiente (no se modificó)

- No existe endpoint para completar módulos que no son quiz (CU-03 del informe): hoy el progreso solo se marca al
  aprobar un quiz, por lo que un curso con módulos de lectura/video no puede certificarse desde la API.
- Cualquier usuario autenticado puede iniciar el quiz de cualquier módulo (no se valida inscripción) y un profesor
  puede editar/asignar cursos de otros profesores (no se valida `instructor_id`).
- CORS acepta cualquier `*.vercel.app` (se mantuvo por compatibilidad con el despliegue actual).
- No se probó en Docker ni en Render (no hay Docker en el entorno de pruebas). Sí se probó con nginx real +
  2 instancias del build compilado. En Render el gateway nginx requiere servicios privados o ajustar el upstream a
  HTTPS; el canary por feature flag (§3.2) funciona sin cambios.
