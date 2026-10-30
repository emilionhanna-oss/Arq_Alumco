import { randomBytes } from 'crypto';
import type { CertificadoRepository, CursoRepository } from '../repositories/contracts';
import type { EventBus } from '../domain/events';
import { AppError } from '../domain/errors';
import { enmascararRut } from '../domain/privacidad';

export class CertificadoService {
  constructor(
    private readonly certificados: CertificadoRepository,
    private readonly cursos: Pick<CursoRepository, 'buscar' | 'moduloIdsDe'>,
    private readonly bus: EventBus,
    private readonly frontendUrl: string,
  ) {}

  private url(hash: string) {
    return `${this.frontendUrl}/certificado/${hash}`;
  }

  async generar(usuarioId: string, cursoId: number) {
    if (!(await this.cursos.buscar(cursoId))) throw new AppError(404, 'Curso no encontrado');

    const moduloIds = await this.cursos.moduloIdsDe(cursoId);
    if (moduloIds.length === 0) throw new AppError(400, 'El curso no tiene módulos');
    const completados = await this.certificados.contarModulosCompletados(usuarioId, moduloIds);
    if (completados < moduloIds.length) throw new AppError(400, 'Debes completar todos los módulos primero');

    const existente = await this.certificados.buscar(usuarioId, cursoId);
    if (existente) return { status: 200, cuerpo: { mensaje: 'Ya tienes un certificado', certificado: existente, urlVerificacion: this.url(existente.hash) } };

    // Antes: sha256(usuario-curso-timestamp), reproducible por fuerza bruta. Ahora 256 bits aleatorios.
    const hash = randomBytes(32).toString('hex');
    const certificado = await this.certificados.crear(hash, usuarioId, cursoId);
    await this.bus.emit('certificado.emitido', { usuarioId, cursoId: String(cursoId) });
    return { status: 201, cuerpo: { mensaje: 'Certificado generado', certificado, urlVerificacion: this.url(certificado.hash) } };
  }

  async verificar(hash: string) {
    const c = await this.certificados.verificar(hash);
    if (!c) throw new AppError(404, 'Certificado no encontrado', { valido: false });
    // Endpoint público: el RUT se enmascara.
    return { valido: true, nombreCompleto: c.nombre_completo, rut: enmascararRut(c.rut), cursoTitulo: c.curso_titulo, emitidoEn: c.emitido_en, hash: c.hash };
  }

  async misCertificados(usuarioId: string) {
    const rows = await this.certificados.listarDe(usuarioId);
    return rows.map(r => ({
      id: r.id, hash: r.hash, cursoId: String(r.curso_id), cursoTitulo: r.curso_titulo,
      cursoImagen: r.imagen_url, emitidoEn: r.emitido_en, urlVerificacion: this.url(r.hash),
    }));
  }
}
