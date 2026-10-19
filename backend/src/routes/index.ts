import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { login, register, listarSedes, me } from '../controllers/authController';
import { listarCursos, obtenerCurso, crearCurso, actualizarCurso, eliminarCurso, asignarAlumnos } from '../controllers/cursosController';
import { iniciarIntento, submitQuiz, estadoQuiz } from '../controllers/quizController';
import { perfilGamificacion, registrarAcceso, ranking, insignias } from '../controllers/gamificacionController';
import { listarUsuarios, obtenerUsuario, actualizarUsuario, miPerfil, actualizarPerfil } from '../controllers/usuariosController';
import { generarCertificado, verificarCertificado, misCertificados } from '../controllers/certificadosController';

const router = Router();

router.post('/auth/login',    login);
router.post('/auth/register', register);
router.get('/auth/sedes',     listarSedes);
router.get('/auth/me',        requireAuth, me);

router.get('/cursos',             requireAuth, listarCursos);
router.get('/cursos/:id',         requireAuth, obtenerCurso);
router.post('/cursos',            requireAuth, requireRole('admin', 'profesor'), crearCurso);
router.put('/cursos/:id',         requireAuth, requireRole('admin', 'profesor'), actualizarCurso);
router.delete('/cursos/:id',      requireAuth, requireRole('admin'), eliminarCurso);
router.put('/cursos/:id/alumnos', requireAuth, requireRole('admin', 'profesor'), asignarAlumnos);

router.post('/quiz/:moduloId/iniciar', requireAuth, iniciarIntento);
router.post('/quiz/:moduloId/submit',  requireAuth, submitQuiz);
router.get('/quiz/:moduloId/estado',   requireAuth, estadoQuiz);

router.get('/gamificacion/perfil',    requireAuth, perfilGamificacion);
router.post('/gamificacion/acceso',   requireAuth, registrarAcceso);
router.get('/gamificacion/ranking',   requireAuth, ranking);
router.get('/gamificacion/insignias', requireAuth, insignias);

router.get('/usuarios',        requireAuth, requireRole('admin'), listarUsuarios);
router.get('/usuarios/perfil', requireAuth, miPerfil);
router.put('/usuarios/perfil', requireAuth, actualizarPerfil);
router.get('/usuarios/:id',    requireAuth, requireRole('admin'), obtenerUsuario);
router.put('/usuarios/:id',    requireAuth, requireRole('admin'), actualizarUsuario);

router.post('/certificados/generar/:cursoId',  requireAuth, generarCertificado);
router.get('/certificados/verificar/:hash',    verificarCertificado);
router.get('/certificados/mis-certificados',   requireAuth, misCertificados);

export default router;
