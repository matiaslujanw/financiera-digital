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

> Estoy reviviendo un sistema de gestión de una financiera. Repo: https://github.com/matiaslujanw/financiera-digital (cloná si hace falta). La app está en `financiera/` (Next.js). Setup: `cd financiera && npm install`, después `npm run dev` (levanta pg-server en :5433 + Next en :3000). **Antes de programar, leé `PLAN.md` en la raíz de punta a punta** — tiene el roadmap, el estado y las decisiones técnicas. Estado: Fases 0, 1 y 2 completas (auth, negocio, dashboard, transacciones y ciclo de cheques). Seguimos con la **Fase 3: préstamos y créditos con cuotas**. La base local arranca vacía en una compu nueva (registrá un negocio en `/register`). Revisá los archivos de referencia `loan.ts`, `loan.tsx`, `credit.ts` y `credit.tsx`, y mostrame un plan corto antes de codear.

---

## Mapa de fases

| # | Fase | Estado | Resultado esperado |
|---|------|--------|--------------------|
| 0 | Cimientos (scaffold, DB, auth, dashboard) | ✅ | La app enciende: login → negocio → dashboard |
| 1 | Transacción regular (movimientos + balances) | ✅ | Crear movimientos entre cuentas y ver balances actualizados |
| 2 | Cheques (compra / venta) | ✅ | Operaciones especiales y ciclo completo de cheques |
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

## Fase 2 — Cheques (compra / venta) ✅

**Meta:** las operaciones especiales de cheques, que son el corazón de la financiera.

Referencia: `special.tsx`, `create.tsx`, `transaction.ts` (`createMultiple`), `lib/financial-utils` (`calculatePurchaseValues`, `calculateSaleValues`), schema `Check` + `CheckOnTransactionGroup`.

> **Dominio (confirmado con el usuario):** *Cartera de cheques* = monto total **neto** de cheques en poder. *Pesificación* e *interés* = tasas que se aplican al comprar/vender para ganar el spread (se compra con descuento, se vende capturando la diferencia).

#### ✅ Fórmulas confirmadas por el usuario (2026-07-21) — usar estas
`bruto` (grossValue) = **valor nominal escrito en el cheque de papel**.

```
díasTotales   = díasEntre(purchaseDate → collectionDate) + bankClearing   // se suma el clearing
pesificación  = bruto × (serviceFeeRate / 100)                            // plana, no depende de días
interésCorrido = bruto × (monthlyInterestRate / 100 / 30) × díasTotales    // interés SIMPLE (prorrateo diario)
neto          = bruto − pesificación − interésCorrido                      // (netValue)
```
Verificación con la captura (pesif. 3%): `pesificación = 3% × bruto` ✓. Nota: `desagio = interésCorrido − pesificación` es solo un valor mostrado en la UI de venta.

**Las 4 transacciones por cheque (COMPRA) — confirmado:**
1. **Cartera de cheques** (ASSET) **+ neto**  (el cheque entra a la cartera por su neto)
2. **Efectivo** (ASSET) **− neto**  (lo que la financiera paga)
3. **Pesificación** (REVENUE) **+ pesificación**
4. **Intereses cobrados** (REVENUE) **+ interésCorrido**

Todo se agrupa en un `TransactionGroup` con `operationType = CHECK_PURCHASE`, y se crea el registro en `Check` (status `PURCHASED`).

**VENTA — confirmada e implementada:** usa la misma fórmula con las tasas de venta, pero `díasTotales = díasEntre(saleDate → collectionDate) + bankClearing`. La permanencia se muestra aparte como `díasEnCartera = díasEntre(purchaseDate → saleDate)`, y la ganancia es `netoVenta − netoCompra`.

Las 4 transacciones por cheque vendido son: **Cartera de cheques −netoCompra**, **Efectivo +netoVenta**, **Pesificación −pesificaciónVenta** e **Intereses cobrados −interésVenta**. Se agrupan en `CHECK_SALE` y el cheque pasa a `SOLD`; los vencidos no se pueden vender.

**DEPÓSITO:** desde `PURCHASED` y al alcanzar la fecha de cobro, **Cartera de cheques −netoCompra** y la cuenta elegida (Banco o Efectivo) **+bruto**. Se agrupa en `CHECK_DEPOSIT` y pasa a `DEPOSITED`.

**RECHAZO:** se registra fecha y motivo, conservando siempre al vendedor original. Desde `PURCHASED`, **Cartera −netoCompra** y la subcuenta de Personas del vendedor **+bruto**. Desde `SOLD`, la subcuenta del vendedor **+bruto** y **Cheques a pagar +bruto**, vinculando la obligación al comprador. Se agrupa en `CHECK_REJECTION`, pasa a `REJECTED` y no mueve Efectivo hasta registrar un pago real.

- [x] **(0)** Preguntas de fórmulas respondidas por el usuario ✔
- [x] Portar `calculatePurchaseValues` a `server/api/lib/financial-utils` con las fórmulas confirmadas + pruebas unitarias
- [x] Portar `calculateSaleValues` con pruebas unitarias
- [x] **Compra de cheques:** alta de uno o varios cheques → crea 4 transacciones por cheque + un `TransactionGroup` (operationType `CHECK_PURCHASE`). Cheque queda `PURCHASED`
- [x] UI compra: formulario con pesificación %, interés mensual %, cliente, fecha; filas de cheque (fecha cobro, clearing, monto, librador, N°, banco); totales en vivo
- [x] **Venta de cheques:** selección de cheques disponibles, cálculo de neto/interés, `TransactionGroup` `CHECK_SALE`. Cheque queda `SOLD`
- [x] UI venta: selección múltiple, vencimiento, días en cartera, días de cálculo, costo de compra, valor de venta, ganancia/pérdida y rentabilidad, por cheque y total
- [x] Estados del cheque `PURCHASED` / `SOLD` / `DEPOSITED` / `REJECTED`
- [x] Depósito opcional a Banco/Efectivo con salida de cartera y cobro del nominal
- [x] Rechazo desde cartera o desde un cheque vendido, con vendedor original, comprador, motivo y cuentas de seguimiento
- [x] **Verificación compra → venta:** ganancia y balances comprobados en navegador y DB
- [x] **Verificación parcial (compra):** compra simple ($100.000 → neto $90.600) y múltiple (2 cheques → 8 movimientos) comprobadas en navegador/DB; balances, grupo y estado `PURCHASED` correctos
- [x] **Verificación de cierre:** depósito, rechazo desde cartera y rechazo posterior a una venta comprobados en navegador y DB

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

### 2026-07-21 — Fase 2 en curso: compra de cheques completada
- Portado `calculatePurchaseValues` con pesificación plana, interés simple diario y clearing; cubierto por pruebas unitarias.
- Agregada mutación atómica `check.purchase`: alta/reutilización rápida de cliente, `Check` en estado `PURCHASED`, vínculo al `TransactionGroup` `CHECK_PURCHASE` y 4 movimientos por cheque con actualización de balances.
- Agregada UI para uno o varios cheques con empresa, cliente, fecha, tasas, datos bancarios y totales en vivo. Por ahora la compra opera en ARS; monedas se ampliarán en la fase correspondiente.
- Verificado end-to-end: compra de $100.000 → cartera +$90.600, efectivo −$90.600, pesificación +$3.000 e intereses +$6.400. También se probó una compra de 2 cheques: un solo grupo `CHECK_PURCHASE`, ambos `PURCHASED` y exactamente 8 transacciones.
- La compra quedó cerrada; el siguiente bloque de trabajo fue la venta de cheques.

### 2026-07-21 — Fase 2 en curso: venta de cheques completada
- Portado `calculateSaleValues` y agregada la mutación atómica `check.sale`, con bloqueo de registros y validación para impedir vender cheques vencidos, ya vendidos o pertenecientes a otra empresa.
- Agregada UI de venta múltiple con comprador, fecha y tasas. Cada fila muestra costo de compra, valor de venta, ganancia/pérdida, días en cartera y días usados para calcular el precio; el resumen agrega valor de venta, resultado, rentabilidad y permanencia promedio.
- Verificado end-to-end con F2-001: costo $90.600, venta $95.300, ganancia $4.700 y 5 días en cartera. Persistió `SOLD`, comprador, grupo `CHECK_SALE` y exactamente 4 movimientos; los balances quedaron consistentes.
- Corregido el prefetch de RSC para esperar las consultas antes de hidratar y evitar que el contador de transacciones difiriera entre servidor y cliente.
- El siguiente bloque fue completar depósito y rechazo (`DEPOSITED` / `REJECTED`).

### 2026-07-21 — Fase 2 completada: depósito y rechazo
- Agregadas migración y operaciones `CHECK_DEPOSIT` / `CHECK_REJECTION`, con fecha de depósito, cuenta de acreditación, fecha/motivo de rechazo y estado previo al rechazo.
- Nueva pantalla **Estado de cheques** con filtros, vencimientos, vendedor original, comprador, valores de compra/venta y seguimiento. Las acciones se habilitan al llegar la fecha de cobro.
- Un rechazo desde cartera saca el neto de Cartera y registra el nominal por cobrar en la subcuenta del vendedor. Si el cheque ya fue vendido, registra el nominal por cobrar al vendedor y el mismo nominal en Cheques a pagar, vinculado al comprador; no modifica caja automáticamente.
- Verificado end-to-end y en DB: F2-R01 vendido y luego rechazado ($40.000 a cobrar y $40.000 a pagar), F2-RP01 rechazado desde cartera ($25.000 a cobrar) y F2-D01 depositado en Banco ($30.000 nominal). Cada cierre creó exactamente 2 movimientos y su grupo correspondiente.
- Corregida la sincronización del input nativo de fecha de compra/cobro detectada durante la prueba visual.
- **Próximo:** Fase 3, préstamos y créditos con cuotas.
