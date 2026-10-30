# CapacitaciónPro — API

```bash
cp .env.example .env            # JWT_SECRET es obligatorio en producción
npm ci
npm run db:migrate              # migraciones versionadas (tabla schema_migrations)
npm run dev
npm test                        # TEST_DATABASE_URL=postgresql://... para incluir integración
npm run build && npm start
```

Patrones y despliegue canario: ver [docs/ARQUITECTURA_Y_CANARY.md](docs/ARQUITECTURA_Y_CANARY.md).

Demostración (lista de endpoints, Postman, curl, canary): [docs/DEMOSTRACION.md](docs/DEMOSTRACION.md)
- `GET /api` → lista de endpoints · `postman/` → colección + environment · `scripts/demo-curl.sh` → flujo con curl
