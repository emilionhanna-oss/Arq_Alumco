/** "12.345.678-9" -> "*****678-9". El endpoint de verificación es público: no debe filtrar el RUT completo. */
export function enmascararRut(rut: string | null | undefined): string {
  if (!rut) return '';
  const limpio = String(rut).replace(/\./g, '');
  const [cuerpo, dv] = limpio.split('-');
  const visibles = cuerpo.slice(-3);
  const oculto = '*'.repeat(Math.max(0, cuerpo.length - visibles.length));
  return dv ? `${oculto}${visibles}-${dv}` : `${oculto}${visibles}`;
}
