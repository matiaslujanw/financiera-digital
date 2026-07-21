# Plan de trabajo — Revivir la financiera

> Documento vivo. Lo vamos tildando a medida que avanzamos. Cada sesión deja una entrada en la **Bitácora** al final.

## Objetivo

Tener de nuevo funcionando el sistema de gestión de la financiera (descuento de cheques, préstamos, créditos, cables, cambio de divisas) con contabilidad de doble entrada, partiendo de los archivos núcleo que sobrevivieron. Reconstruido como **una sola app Next.js** en `financiera/`, lo más simple que corra, respetando el stack original.

## Cómo trabajamos

- Los **archivos originales** (raíz del proyecto: `transaction.ts`, `schema.ts`, `create.tsx`, etc.) son la **fuente de referencia**. De ahí portamos la lógica; no se tocan.
- La app viva está en `financiera/`. Correr: `cd financiera && npm run dev` → http://localhost:3000 (levanta el pg-server en :5433 + Next en :3000).
- **Login de prueba:** `mati@test.com` / `test123`. ⚠️ La base (`financiera/.pglite`) está en `.gitignore`, así que **NO viaja en el repo**: en una compu nueva la DB arranca vacía → crear el negocio desde `/register`. En la compu original los datos persisten.
- **Repo:** https://github.com/matiaslujanw/financiera-digital — en compu nueva: clonar, `cd financiera && npm install`, luego `npm run dev`.
- Vamos **fase por fase**. Cada fase termina con una verificación en el navegador (que se vea y funcione), no solo que compile.
- Leyenda de estado: ✅ hecho · 🔜 en curso · ⬜ pendiente · 🧊 diferido (más adelante)

### Dominio del negocio (cheques) — clave para la Fase 2
- **Cartera de cheques** = el monto total **neto** de cheques que la financiera tiene.
- **Pesificación** e **interés** = tasas que se aplican a un cheque **al comprar/vender** y son el mecanismo por el que se **gana el porcentaje** (spread): se compra con descuento y se vende capturando la diferencia.
- Las fórmulas exactas (`calculatePurchaseValues`/`calculateSaleValues`) se **reconstruyen y confirman con el usuario** en la Fase 2.

### Continuar en otra sesión / otra computadora (handoff)
En **otra computadora** el contexto viaja SOLO por el repo (este `PLAN.md`) — las memorias quedan en la máquina original. Este PLAN es autosuficiente. Pegá este prompt en la sesión nueva:

> Estoy reviviendo un sistema de gestión de una financiera. Repo: https://github.com/matiaslujanw/financiera-digital (cloná si hace falta). La app está en `financiera/` (Next.js). Setup: `cd financiera && npm install`, después `npm run dev` (levanta pg-server en :5433 + Next en :3000). **Antes de programar, leé `PLAN.md` en la raíz de punta a punta** — tiene el roadmap, el estado, las decisiones técnicas y las "Preguntas abiertas — Fase 2". Estado: Fases 0 y 1 completas (auth + negocio + dashboard + transacción regular con balances). Seguimos con la **Fase 2 (cheques)**: primero respondé conmigo las "Preguntas abiertas — Fase 2" del PLAN antes de implementar las fórmulas de compra/venta. La base local arranca vacía en una compu nueva (registrá un negocio en `/register`).

---

## Mapa de fases

| # | Fase | Estado | Resultado esperado |
|---|------|--------|--------------------|
| 0 | Cimientos (scaffold, DB, auth, dashboard) | ✅ | La app enciende: login → negocio → dashboard |
| 1 | Transacción regular (movimientos + balances) | ✅ | Crear movimientos entre cuentas y ver balances actualizados |
| 2 | Cheques (compra / venta) | ⬜ | Operaciones especiales de cheques con pesificación/interés/desagio |
| 3 | Préstamos y Créditos (cuotas) | ⬜ | Alta de préstamos/créditos y cobro de cuotas |
| 4 | Cables y Cambio de divisas | ⬜ | Transferencias con comisión y conversión de moneda |
| 5 | Entidades y catálogos (personas, subcuentas, categorías) | ⬜ | ABM de clientes, subcuentas y categorías |
| 6 | Multi-empresa, miembros y permisos | ⬜ | Varias empresas por negocio, invitar miembros, permisos |
| 7 | Reportes, comprobantes y dashboard | ⬜ | Contadores, comprobante con firma, export CSV |
| 8 | Pulido y producción | 🧊 | Postgres real, auth robusta, notificaciones, logs |

---

## Fase 0 — Cimientos ✅

- [x] Scaffold Next.js 16 (App Router, TS, Tailwind v4, alias `~/*` + `@acme/*`)
- [x] Drizzle + PGlite (Postgres embebido) + schema portado + migraciones automáticas
- [x] tRPC v11 (server + cliente con integración tanstack-react-query)
- [x] Auth propia (scrypt + cookie de sesión) — register / login / logout
- [x] Bootstrap del negocio al registrarse (Guild + Member OWNER + Business + plan de cuentas)
- [x] Dashboard MVP: Resumen de cuentas (balances por tipo) + tabla de transacciones
- [x] Verificado end-to-end en el navegador

---

## Fase 1 — Transacción regular (movimientos + balances) ✅

**Meta:** poder crear una transacción que mueva plata de una cuenta a otra (o ingreso/egreso) y que los balances del Resumen se actualicen. Es la base contable de todo lo demás.

Referencia: `transaction.ts` (`create`, `modify`), `movement/movement-dialog.tsx`, `lib/utils` (`updateParentAccount`, `convertAmount`), `lib/financial-utils`.

- [x] Portar helpers server: `server/api/lib/dayjs.ts`, `utils.ts` (`updateParentAccount`, `combineDateWithCurrentTime`, `formatForSubmit`, `convertAmount`)
- [x] Portar los validators que usa `transaction.create` a `server/validators` (`TransactionCreateSchema`)
- [x] Portar `transaction.create` al router real (caso 1 cuenta y caso 2 cuentas, con subcuentas por entidad), con actualización de `currentBalance`
- [x] UI: diálogo "Nueva transacción" (ingreso/egreso sobre una cuenta), con selects de empresa y cuenta
- [x] Invalidar/refrescar el Resumen de cuentas y la tabla tras crear
- [x] **Verificación:** ingreso (+$500k→$500k), egreso (−$200k→$300k) y otro ingreso ($1M) reflejados en el Resumen ✔
- [ ] (Pendiente para más adelante) UI de transferencia entre 2 cuentas y con subcuentas/entidades; componente `form` de shadcn; `modify`

### Nota técnica importante — arquitectura de la DB (resuelto en F1)
Next 16 dev levanta **varios procesos**, y cada uno abría su propia instancia de PGlite sobre el mismo directorio → el migrador fallaba y había riesgo de corrupción. **Solución:** un proceso dedicado (`scripts/pg-server.mjs`) corre UNA instancia PGlite y la sirve por socket (protocolo Postgres); la app se conecta con **node-postgres (`pg`)** vía `drizzle-orm/node-postgres`. `npm run dev` ahora levanta pg-server (puerto 5433) + `next dev` en paralelo (`concurrently`). Migrar a Postgres real = setear `DATABASE_URL`.

---

## Fase 2 — Cheques (compra / venta) ⬜

**Meta:** las operaciones especiales de cheques, que son el corazón de la financiera.

Referencia: `special.tsx`, `create.tsx`, `transaction.ts` (`createMultiple`), `lib/financial-utils` (`calculatePurchaseValues`, `calculateSaleValues`), schema `Check` + `CheckOnTransactionGroup`.

> **Dominio (confirmado con el usuario):** *Cartera de cheques* = monto total **neto** de cheques en poder. *Pesificación* e *interés* = tasas que se aplican al comprar/vender para ganar el spread (se compra con descuento, se vende capturando la diferencia).

#### ⚠️ Preguntas abiertas — responder ANTES de implementar (el fuente de las fórmulas NO está)
Datos observados en las capturas (`compra-cheque.jpeg`, `venta-cheque.jpeg`, `logica-venta-cheque.jpeg`): columnas *Cant. días · C. bancario · Días totales · Interés corrido · Monto interés · Monto pesificación · Valor neto*. En una venta con pesificación 3% e interés 4%: `Total Pesificación = 3% × bruto` (114.300 = 3% de 3.810.000 ✓) y `Total Desagio = Total Interés − Total Pesificación`. Falta confirmar:

1. **Días:** ¿"Días totales" = días desde la fecha de operación hasta `collectionDate` **+** `bankClearing` (días de clearing)? ¿O sin clearing?
2. **Interés corrido:** dado el interés mensual %, ¿cómo se prorratea por día? ¿`interésCorrido = bruto × (tasaMensual/30) × díasTotales`? ¿Simple o compuesto?
3. **Pesificación:** ¿`pesificación = bruto × tasaPesificación%`, plana (no depende de días)? (parece que sí)
4. **Valor neto:** ¿`neto = bruto − pesificación − interésCorrido`? Confirmar relación exacta entre bruto, pesificación, interés, **desagio** y neto.
5. **Las 4 transacciones por cheque** (la UI de compra dice "se crearán 4 transacciones por cheque"): ¿cuáles son y contra qué cuentas? (hipótesis: Cartera de cheques +neto, Efectivo −neto, Pesificación +, Intereses cobrados +). Confirmar.
6. **Compra vs venta:** al comprar, ¿se paga el neto y el cheque entra a Cartera por su neto? Al vender, ¿mismo cálculo con tasas de venta y la ganancia = diferencia? ¿Se registra contra las cuentas REVENUE *Pesificación* e *Intereses cobrados*?

- [ ] **(0)** Responder las preguntas de arriba con el usuario
- [ ] Portar `calculatePurchaseValues` / `calculateSaleValues` (pesificación, interés mensual, interés corrido, desagio, valor neto)
- [ ] **Compra de cheques:** alta de uno o varios cheques → crea las transacciones por cheque + un `TransactionGroup` (operationType `CHECK_PURCHASE`). Cheque queda `PURCHASED`
- [ ] UI compra: formulario con pesificación %, interés mensual %, cliente, fecha; filas de cheque (fecha cobro, clearing, monto, librador, N°, banco); totales en vivo
- [ ] **Venta de cheques:** selección de cheques disponibles, cálculo de neto/interés/desagio, `TransactionGroup` `CHECK_SALE`. Cheque queda `SOLD`
- [ ] UI venta: lista de cheques disponibles con estado (vencido/días), selección múltiple, totales
- [ ] Estados del cheque (`PURCHASED` / `SOLD` / `DEPOSITED` / `REJECTED`)
- [ ] **Verificación:** comprar cheques y luego venderlos; ver ganancia y balances

---

## Fase 3 — Préstamos y Créditos (cuotas) ⬜

Referencia: `loan.ts`, `loan.tsx`, `credit.ts`, `credit.tsx`, schema `Loan`/`Credit`/`Installment`.

- [ ] Portar router `loan` (alta con generación de cuotas según periodicidad)
- [ ] Portar router `credit` (idem)
- [ ] Cobro de cuotas → genera transacción y actualiza estado de la cuota/préstamo
- [ ] UI de alta y de detalle (cuotas, pagos, estado)
- [ ] **Verificación:** dar de alta un préstamo, ver cuotas, cobrar una

---

## Fase 4 — Cables y Cambio de divisas ⬜

Referencia: schema `Cable`, `movement/exchange-rate-dialog.tsx`, `OperationType` `CABLE` / `CURRENCY_EXCHANGE`.

- [ ] Cable (transferencia) con comisión → transacción + `TransactionGroup` `CABLE`
- [ ] Cambio de divisas con tipo de cambio (`exchangeRate`) entre cuentas de distinta moneda
- [ ] UI del diálogo de tipo de cambio
- [ ] **Verificación:** hacer un cable y un cambio ARS↔USD

---

## Fase 5 — Entidades y catálogos ⬜

- [ ] Personas (clientes): ABM, usados como contraparte en operaciones
- [ ] Subcuentas: cuentas con `hasSubAccounts` (Personas/Vehículos/Propiedades/Maquinarias) y su selección (`account-selection-dialog`, `subaccount-selection-dialog`)
- [ ] Categorías de transacción
- [ ] Vehículos / Propiedades / Maquinarias (entidades del dashboard)

---

## Fase 6 — Multi-empresa, miembros y permisos ⬜

- [ ] Crear varias empresas (Business) dentro de un negocio
- [ ] Invitar miembros (Invite) y roles (OWNER / MANAGER / MEMBER)
- [ ] Permisos por empresa y por cuenta (`MemberOnBusiness`, `MemberOnAccountOnBusiness`)
- [ ] Selector de empresa/negocio en la UI

---

## Fase 7 — Reportes, comprobantes y dashboard ⬜

Referencia: dashboard `dashboard.jpeg`, `transaction.ts` (`export`, `getPublicReceipt`, `saveSignature`, `byAccountForPeriod`).

- [ ] Contadores del dashboard (Miembros, Dic. de cuenta, Cheques, Cables, Préstamos, Créditos, Personas, etc.)
- [ ] Gráfico "Ganancia por venta de cheques" por período
- [ ] Generar comprobante de operación + firma (signature) y link público (`getPublicReceipt`)
- [ ] Export CSV de transacciones (papaparse)
- [ ] Filtros de la tabla (fecha, tipo de operación, persona, búsqueda)

---

## Fase 8 — Pulido y producción 🧊

- [ ] Opción de Postgres real (Neon/Supabase) cambiando `DATABASE_URL` (hoy PGlite local)
- [ ] Auth más robusta (Auth.js o Supabase) si hace falta
- [ ] Notificaciones (schema `Notification`) y chat (schema `Chat*`)
- [ ] Logs / auditoría (`Log`)
- [ ] Deploy

---

## Decisiones técnicas (por qué)

- **Una sola app** (no monorepo `@acme/*`) → menos ceremonia. Los alias `@acme/*` se mapean a rutas locales en `tsconfig.json` para portar los archivos originales con cambios mínimos.
- **PGlite** (Postgres embebido WASM) → cero fricción local (sin Docker ni nube). Migrar a Postgres real = cambiar una variable. Persiste en `financiera/.pglite`.
- **tRPC v11** con integración tanstack-react-query → igual que el código original (`useTRPC`, `prefetch`, `HydrateClient`).
- **zod v3** (no v4) → compatibilidad con el código original.
- **Auth propia** (scrypt + cookie) → reemplaza el Supabase Auth original sin depender de una cuenta.
- **Convención `discharged = true` = ACTIVO** (heredada del schema original).

## Estructura de la app (`financiera/`)

```
server/
  db/         schema.ts (portado), auth.ts, index.ts (PGlite+drizzle)
  api/        trpc.ts, root.ts, router/*, lib/*
  validators/ (schemas zod — se irá llenando al portar)
  auth.ts, auth-actions.ts, bootstrap.ts
trpc/         react.tsx (cliente), server.tsx (RSC), query-client.ts
app/          login, register, dashboard/[guildSlug]/transactions, api/trpc
components/   ui/ (shadcn), auth/, dashboard/
utils/        format.ts, dayjs.ts
```

---

## Bitácora

### 2026-07-21 — Fase 0 completada
- Reconstruido el chasis: scaffold, DB (PGlite), tRPC, auth propia, bootstrap del negocio, dashboard MVP.
- Verificado end-to-end en el navegador: registro → negocio "Financiera Mati" (OWNER) → dashboard con Resumen de cuentas y tabla de transacciones → logout → login.

### 2026-07-21 — Fase 1 completada
- Portados helpers (`server/api/lib/{dayjs,utils}.ts`), validators (`TransactionCreateSchema`) y `transaction.create` (lógica contable de doble entrada: `getTransactionType`/`calculateNewBalance`, balance corriente + `currentBalance`).
- UI "Nueva transacción" (ingreso/egreso). Verificado: los balances del Resumen se actualizan correctamente.
- **Refactor de DB** (ver Nota técnica en Fase 1): de PGlite in-process (multi-proceso, con conflictos) a pg-server dedicado por socket + cliente `pg`. Log limpio, sin race ni corrupción.
- Próximo: **Fase 2** (cheques: compra/venta con pesificación/interés/desagio).
