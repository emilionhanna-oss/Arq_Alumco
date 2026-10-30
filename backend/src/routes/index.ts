import { Router, type RequestHandler } from 'express';
import type { Container } from '../container';
import { buildControllers } from '../controllers';
import { requireAuth, requireRole } from '../middleware/auth';

type Metodo = 'get' | 'post' | 'put' | 'delete';

export interface RutaDef {
  metodo: Metodo;
  ruta: string;
  handler: RequestHandler;
  auth: boolean;
  roles?: string[];
  descripcion: string;
}

/** Endpoints de sistema (fuera de /api) para mostrarlos junto con los de negocio. */
export const ENDPOINTS_SISTEMA = [
  { metodo: 'GET', ruta: '/', acceso: 'pública', descripcion: 'Mensaje de bienvenida de la API' },
  { metodo: 'GET', ruta: '/health', acceso: 'pública', descripcion: 'Readiness: versión, track, estado de la BD y del circuit breaker (503 si la BD está caída)' },
  { metodo: 'GET', ruta: '/health/live', acceso: 'pública', descripcion: 'Liveness: el proceso responde (no consulta la BD)' },
  { metodo: 'GET', ruta: '/health/ready', acceso: 'pública', descripcion: 'Igual que /health' },
  { metodo: 'GET', ruta: '/metrics', acceso: 'pública (o Bearer METRICS_TOKEN)', descripcion: 'Métricas Prometheus por versión/track, base de la decisión canary' },
];

/**
 * Tabla ÚNICA de rutas: de aquí salen el router de Express y el listado que devuelve GET /api,
 * así la documentación mostrada en la demo no puede desincronizarse del código.
 */
export function definirRutas(container: Container): RutaDef[] {
  const c = buildControllers(container);
  const ADMIN = ['admin'], STAFF = ['admin', 'profesor'];
  return [
    { metodo: 'post', ruta: '/auth/login', handler: c.auth.login, auth: false, descripcion: 'Inicia sesión y entrega el JWT (8 h)' },
    { metodo: 'post', ruta: '/auth/register', handler: c.auth.register, auth: false, descripcion: 'Registra un colaborador (queda pendiente de aprobación)' },
    { metodo: 'get', ruta: '/auth/sedes', handler: c.auth.sedes, auth: false, descripcion: 'Lista las sedes disponibles' },
    { metodo: 'get', ruta: '/auth/me', handler: c.auth.me, auth: true, descripcion: 'Datos del usuario autenticado' },

    { metodo: 'get', ruta: '/cursos', handler: c.cursos.listar, auth: true, descripcion: 'Cursos publicados del usuario (admin: ?all=1 lista todos)' },
    { metodo: 'get', ruta: '/cursos/:id', handler: c.cursos.obtener, auth: true, descripcion: 'Detalle de un curso (el alumno no recibe las respuestas correctas)' },
    { metodo: 'post', ruta: '/cursos', handler: c.cursos.crear, auth: true, roles: STAFF, descripcion: 'Crea un curso con sus módulos' },
    { metodo: 'put', ruta: '/cursos/:id', handler: c.cursos.actualizar, auth: true, roles: STAFF, descripcion: 'Edita/publica un curso (conserva el progreso de los alumnos)' },
    { metodo: 'delete', ruta: '/cursos/:id', handler: c.cursos.eliminar, auth: true, roles: ADMIN, descripcion: 'Elimina un curso' },
    { metodo: 'put', ruta: '/cursos/:id/alumnos', handler: c.cursos.asignar, auth: true, roles: STAFF, descripcion: 'Asigna alumnos a un curso' },

    { metodo: 'post', ruta: '/quiz/:moduloId/iniciar', handler: c.quiz.iniciar, auth: true, descripcion: 'Inicia un intento de examen (máx. 2, bloqueo 24 h al reprobar)' },
    { metodo: 'post', ruta: '/quiz/:moduloId/submit', handler: c.quiz.enviar, auth: true, descripcion: 'Envía respuestas; califica y dispara puntos/insignias (Observer)' },
    { metodo: 'get', ruta: '/quiz/:moduloId/estado', handler: c.quiz.estado, auth: true, descripcion: 'Intentos realizados/restantes, mejor puntaje e historial' },

    { metodo: 'get', ruta: '/gamificacion/perfil', handler: c.gamificacion.perfil, auth: true, descripcion: 'Puntos, nivel, racha, insignias y módulos completados' },
    { metodo: 'post', ruta: '/gamificacion/acceso', handler: c.gamificacion.acceso, auth: true, descripcion: 'Registra el acceso diario y actualiza la racha' },
    { metodo: 'get', ruta: '/gamificacion/ranking', handler: c.gamificacion.ranking, auth: true, descripcion: 'Ranking (?sede=...). Canary por feature flag: header X-Ranking-Version v1|v2' },
    { metodo: 'get', ruta: '/gamificacion/insignias', handler: c.gamificacion.insignias, auth: true, descripcion: 'Insignias del usuario' },

    { metodo: 'get', ruta: '/usuarios', handler: c.usuarios.listar, auth: true, roles: ADMIN, descripcion: 'Lista todos los usuarios' },
    { metodo: 'get', ruta: '/usuarios/perfil', handler: c.usuarios.miPerfil, auth: true, descripcion: 'Perfil propio' },
    { metodo: 'put', ruta: '/usuarios/perfil', handler: c.usuarios.actualizarPerfil, auth: true, descripcion: 'Actualiza el perfil propio (nombre, firma)' },
    { metodo: 'get', ruta: '/usuarios/:id', handler: c.usuarios.obtener, auth: true, roles: ADMIN, descripcion: 'Detalle de un usuario' },
    { metodo: 'put', ruta: '/usuarios/:id', handler: c.usuarios.actualizar, auth: true, roles: ADMIN, descripcion: 'Aprueba cuentas, asigna roles/estado/sede' },

    { metodo: 'post', ruta: '/certificados/generar/:cursoId', handler: c.certificados.generar, auth: true, descripcion: 'Genera el certificado si completó todos los módulos (idempotente)' },
    { metodo: 'get', ruta: '/certificados/verificar/:hash', handler: c.certificados.verificar, auth: false, descripcion: 'Verifica un certificado por su hash (RUT enmascarado)' },
    { metodo: 'get', ruta: '/certificados/mis-certificados', handler: c.certificados.mis, auth: true, descripcion: 'Certificados del usuario' },
  ];
}

const acceso = (d: RutaDef) => (!d.auth ? 'pública' : d.roles ? `JWT + rol ${d.roles.join(' o ')}` : 'JWT');

export function buildRouter(container: Container, info: { version: string; track: string }): Router {
  const rutas = definirRutas(container);
  const auth = requireAuth(container.services.auth);
  const r = Router();

  // Lista de endpoints del sistema (para la demostración y para Postman/curl).
  r.get('/', (_req, res) => {
    res.json({
      api: 'CapacitaciónPro', version: info.version, track: info.track,
      totalEndpointsNegocio: rutas.length,
      endpoints: rutas.map(d => ({ metodo: d.metodo.toUpperCase(), ruta: `/api${d.ruta}`, acceso: acceso(d), descripcion: d.descripcion })),
      sistema: ENDPOINTS_SISTEMA,
    });
  });

  for (const d of rutas) {
    const cadena: RequestHandler[] = [];
    if (d.auth) cadena.push(auth);
    if (d.roles) cadena.push(requireRole(...d.roles));
    cadena.push(d.handler);
    r[d.metodo](d.ruta, ...cadena);
  }
  return r;
}
