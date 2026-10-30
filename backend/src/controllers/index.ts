import type { Container } from '../container';
import { parseId } from '../domain/errors';
import { wrap } from '../middleware/errors';

const texto = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Controladores delgados: traducen HTTP <-> servicios. Sin SQL ni reglas de negocio. */
export function buildControllers({ services: s, flags }: Container) {
  return {
    auth: {
      login: wrap(async (req, res) => { res.status(200).json(await s.auth.login(req.body?.email, req.body?.password)); }),
      register: wrap(async (req, res) => { res.status(201).json(await s.auth.registrar(req.body || {})); }),
      sedes: wrap(async (_req, res) => { res.status(200).json(await s.auth.listarSedes()); }, 'Error al obtener sedes'),
      me: wrap(async (req, res) => { res.status(200).json(await s.auth.me(req.user!.id)); }),
    },
    cursos: {
      listar: wrap(async (req, res) => { res.status(200).json(await s.cursos.listar(req.user!, req.query.all === '1')); }, 'No se pudieron obtener los cursos'),
      obtener: wrap(async (req, res) => { res.status(200).json(await s.cursos.obtener(req.user!, parseId(req.params.id))); }, 'Error al obtener curso'),
      crear: wrap(async (req, res) => { res.status(201).json(await s.cursos.crear(req.user!, req.body || {})); }, 'No se pudo crear el curso'),
      actualizar: wrap(async (req, res) => { res.status(200).json(await s.cursos.actualizar(parseId(req.params.id), req.body || {})); }, 'No se pudo actualizar el curso'),
      eliminar: wrap(async (req, res) => { res.status(200).json(await s.cursos.eliminar(parseId(req.params.id))); }, 'No se pudo eliminar el curso'),
      asignar: wrap(async (req, res) => { res.status(200).json(await s.cursos.asignarAlumnos(parseId(req.params.id), req.body?.alumnosInscritos)); }, 'No se pudo asignar alumnos'),
    },
    quiz: {
      iniciar: wrap(async (req, res) => { res.status(201).json(await s.quiz.iniciar(req.user!.id, parseId(req.params.moduloId, 'moduloId'))); }, 'Error al iniciar intento'),
      enviar: wrap(async (req, res) => { res.status(200).json(await s.quiz.enviar(req.user!.id, parseId(req.params.moduloId, 'moduloId'), req.body || {})); }, 'Error al procesar quiz'),
      estado: wrap(async (req, res) => { res.status(200).json(await s.quiz.estado(req.user!.id, parseId(req.params.moduloId, 'moduloId'))); }, 'Error al obtener estado quiz'),
    },
    gamificacion: {
      perfil: wrap(async (req, res) => { res.status(200).json(await s.gamificacion.perfil(req.user!.id)); }, 'Error al obtener perfil de gamificación'),
      acceso: wrap(async (req, res) => { res.status(200).json(await s.gamificacion.registrarAcceso(req.user!.id)); }, 'Error al registrar acceso'),
      ranking: wrap(async (req, res) => {
        // Canary por funcionalidad: un % estable de usuarios recibe la implementación v2.
        const version = flags.isEnabled('ranking_v2', req.user!.id) ? 'v2' : 'v1';
        res.setHeader('X-Ranking-Version', version);
        res.status(200).json(await s.gamificacion.ranking(texto(req.query.sede), version));
      }, 'Error al obtener ranking'),
      insignias: wrap(async (req, res) => { res.status(200).json(await s.gamificacion.insignias(req.user!.id)); }, 'Error al obtener insignias'),
    },
    usuarios: {
      listar: wrap(async (_req, res) => { res.status(200).json(await s.usuarios.listar()); }, 'Error al listar usuarios'),
      obtener: wrap(async (req, res) => { res.status(200).json(await s.usuarios.obtener(parseId(req.params.id))); }, 'Error al obtener usuario'),
      actualizar: wrap(async (req, res) => { res.status(200).json(await s.usuarios.actualizar(parseId(req.params.id), req.body || {})); }, 'Error al actualizar usuario'),
      miPerfil: wrap(async (req, res) => { res.status(200).json(await s.usuarios.miPerfil(req.user!.id)); }, 'Error al obtener perfil'),
      actualizarPerfil: wrap(async (req, res) => { res.status(200).json(await s.usuarios.actualizarPerfil(req.user!.id, req.body || {})); }, 'Error al actualizar perfil'),
    },
    certificados: {
      generar: wrap(async (req, res) => {
        const { status, cuerpo } = await s.certificados.generar(req.user!.id, parseId(req.params.cursoId, 'cursoId'));
        res.status(status).json(cuerpo);
      }, 'Error al generar certificado'),
      verificar: wrap(async (req, res) => { res.status(200).json(await s.certificados.verificar(String(req.params.hash))); }, 'Error al verificar certificado'),
      mis: wrap(async (req, res) => { res.status(200).json(await s.certificados.misCertificados(req.user!.id)); }, 'Error al obtener certificados'),
    },
  };
}
