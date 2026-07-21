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

> Estoy reviviendo un sistema de gestión de una financiera. Repo: https://github.com/matiaslujanw/financiera-digital (cloná si hace falta). La app está en `financiera/` (Next.js). Setup: `cd financiera && npm install`, después `npm run dev` (levanta pg-server en :5433 + Next en :3000). **Antes de programar, leé `PLAN.md` en la raíz de punta a punta** — tiene el roadmap, el estado y las decisiones técnicas. Estado: Fases 0 a 4 completas (auth, negocio, transacciones, ciclo de cheques, navegación, Cuentas, Operaciones, cuentas multimoneda y divisas). Lo próximo a definir es la **Fase 5: préstamos y créditos con cuotas**. La base local arranca vacía en una compu nueva (registrá un negocio en `/register`).

---

## Mapa de fases

| # | Fase | Estado | Resultado esperado |
|---|------|--------|--------------------|
| 0 | Cimientos (scaffold, DB, auth, dashboard) | ✅ | La app enciende: login → negocio → dashboard |
| 1 | Transacción regular (movimientos + balances) | ✅ | Crear movimientos entre cuentas y ver balances actualizados |
| 2 | Cheques (compra / venta) | ✅ | Operaciones especiales y ciclo completo de cheques |
| 3 | Navegación, Cuentas y Operaciones | ✅ | Sidebar real, mayor por cuenta y operaciones agrupadas |
| 4 | Cuentas operativas y Divisas | ✅ | Crear cuentas por moneda y cambiar divisas con cotización |
| 5 | Préstamos y Créditos (cuotas) | ⬜ | Alta de préstamos/créditos y cobro de cuotas |
| 6 | Cables | ⬜ | Transferencias con comisión |
| 7 | Entidades y catálogos (personas, subcuentas, categorías) | ⬜ | ABM de clientes, subcuentas y categorías |
| 8 | Multi-empresa, miembros y permisos | ⬜ | Varias empresas por negocio, invitar miembros, permisos |
| 9 | Reportes, comprobantes y dashboard | ⬜ | Contadores, comprobante con firma, export CSV |
| 10 | Pulido y producción | 🧊 | Postgres real, auth robusta, notificaciones, logs |

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

## Fase 3 — Navegación, Cuentas y Operaciones ✅

**Meta:** pasar de una única pantalla técnica a un sistema navegable. Separar el mayor contable por cuenta de las operaciones comerciales: una operación ocupa una fila y sus asientos se consultan dentro del detalle.

Referencia visual: `imagenes/transacciones.jpeg`, `imagenes/pantalla-operaciones.jpeg`, `imagenes/dashboard.jpeg`; referencia de datos: `transaction.ts` (`byAccountIdWithCursor`, grupos y detalle).

- [x] Sidebar responsive compartido con accesos a Cuentas y Operaciones
- [x] Pantalla **Cuentas**: buscador/árbol por empresa y tipo, selección de cuenta, saldo actual y moneda
- [x] Mayor por cuenta con fecha, operación, descripción, contraparte, entrada/salida y saldo posterior
- [x] Las cuentas agregadas incluyen los movimientos de sus subcuentas
- [x] Pantalla **Operaciones**: una fila por `TransactionGroup`, no una fila por asiento
- [x] Filtros por texto, fecha y tipo de operación; paginación sobre datos reales
- [x] Detalle de operación con cheques vinculados, valores de compra/venta/resultado y todos sus movimientos
- [x] Mantener las acciones existentes: transacción, compra, venta y seguimiento de cheques
- [x] **Verificación:** sidebar y vista móvil; mayor de Banco/Cartera/Personas; búsqueda; compra múltiple, venta y rechazo agrupados; venta F2-001 con $95.300 de venta y $4.700 de resultado

> **Datos:** no se usa mock data. Autenticación, negocios, plan de cuentas, personas, cheques, grupos y movimientos se leen/escriben en la PGlite local (`financiera/.pglite`) mediante Drizzle. La DB no se versiona y en otra computadora empieza vacía; el registro solo crea la estructura inicial y el plan de cuentas.

---

## Fase 4 — Cuentas operativas y Divisas ✅

**Meta:** completar el núcleo ya visible antes de sumar módulos nuevos: administrar cuentas reales en distintas monedas y registrar compras/ventas de divisas con doble entrada.

Referencia: `movement/exchange-rate-dialog.tsx`, `transaction.ts` (`exchangeRate`, `CURRENCY_EXCHANGE`) y la pantalla Cuentas de la Fase 3.

- [x] Sidebar de escritorio colapsable sin perder navegación ni estado entre pantallas
- [x] Alta de cuenta con empresa, nombre, tipo contable y moneda
- [x] Monedas disponibles: ARS, USD, EUR, BRL, GBP, CHF, JPY, CNY, CAD, AUD, MXN y USDT
- [x] Las cuentas nuevas aparecen inmediatamente en Cuentas, transacciones y selectores operativos
- [x] UI **Cambiar divisas**: cuenta de origen, cuenta destino, cantidad y cotización explícita
- [x] Compra contra pesos: `pesos entregados = divisa comprada × cotización ARS`
- [x] Venta contra pesos: `pesos recibidos = divisa vendida × cotización ARS`
- [x] Cruce entre otras monedas: `destino = origen × cotización` mostrando `1 ORIGEN = X DESTINO`
- [x] Un `TransactionGroup` `CURRENCY_EXCHANGE` con 2 movimientos atómicos y actualización de ambos saldos
- [x] Operaciones muestra monto origen, monto destino y cotización; Cuentas usa la moneda correcta en saldo y mayor
- [x] **Verificación:** creada Caja USD; compra de USD 10 a $1.000 y venta de USD 4 a $1.100 registradas correctamente contra Banco

---

## Fase 5 — Préstamos y Créditos (cuotas) ⬜

Referencia: `loan.ts`, `loan.tsx`, `credit.ts`, `credit.tsx`, schema `Loan`/`Credit`/`Installment`.

- [ ] Portar router `loan` (alta con generación de cuotas según periodicidad)
- [ ] Portar router `credit` (idem)
- [ ] Cobro de cuotas → genera transacción y actualiza estado de la cuota/préstamo
- [ ] UI de alta y de detalle (cuotas, pagos, estado)
- [ ] **Verificación:** dar de alta un préstamo, ver cuotas, cobrar una

---

## Fase 6 — Cables ⬜

Referencia: schema `Cable`, `OperationType` `CABLE`.

- [ ] Cable (transferencia) con comisión → transacción + `TransactionGroup` `CABLE`
- [ ] **Verificación:** registrar un cable con su comisión

---

## Fase 7 — Entidades y catálogos ⬜

- [ ] Personas (clientes): ABM, usados como contraparte en operaciones
- [ ] Subcuentas: cuentas con `hasSubAccounts` (Personas/Vehículos/Propiedades/Maquinarias) y su selección (`account-selection-dialog`, `subaccount-selection-dialog`)
- [ ] Categorías de transacción
- [ ] Vehículos / Propiedades / Maquinarias (entidades del dashboard)

---

## Fase 8 — Multi-empresa, miembros y permisos ⬜

- [ ] Crear varias empresas (Business) dentro de un negocio
- [ ] Invitar miembros (Invite) y roles (OWNER / MANAGER / MEMBER)
- [ ] Permisos por empresa y por cuenta (`MemberOnBusiness`, `MemberOnAccountOnBusiness`)
- [ ] Selector de empresa/negocio en la UI

---

## Fase 9 — Reportes, comprobantes y dashboard ⬜

Referencia: dashboard `dashboard.jpeg`, `transaction.ts` (`export`, `getPublicReceipt`, `saveSignature`, `byAccountForPeriod`).

- [ ] Contadores del dashboard (Miembros, Dic. de cuenta, Cheques, Cables, Préstamos, Créditos, Personas, etc.)
- [ ] Gráfico "Ganancia por venta de cheques" por período
- [ ] Generar comprobante de operación + firma (signature) y link público (`getPublicReceipt`)
- [ ] Export CSV de transacciones (papaparse)
- [ ] Filtros de la tabla (fecha, tipo de operación, persona, búsqueda)

---

## Fase 10 — Pulido y producción 🧊

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
app/          login, register, dashboard/[guildSlug]/{accounts,operations}, api/trpc
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
- El roadmap se repriorizó antes de préstamos para construir primero navegación, Cuentas y Operaciones.

### 2026-07-21 — Fase 3 completada: navegación, Cuentas y Operaciones
- Repriorizado el roadmap antes de préstamos: primero se separa la navegación del sistema, el mayor por cuenta y el listado de operaciones comerciales agrupadas.
- Confirmado que la app no usa mocks: los datos visibles salen de la PGlite local; los registros de prueba también quedan persistidos allí y no viajan con Git.
- Referencias visuales relevadas: `transacciones.jpeg` para el árbol/mayor de cuentas y `pantalla-operaciones.jpeg` para filtros, agrupación y detalle.
- Agregado sidebar responsive y rutas dedicadas `/accounts` y `/operations`; la ruta vieja `/transactions` redirige a Cuentas.
- Cuentas muestra saldos y mayor real, reconstruye el saldo histórico y agrega los movimientos de subcuentas en cuentas como Personas.
- Operaciones pagina y filtra grupos reales; cada detalle expone cheques, compra, venta, ganancia y asientos contables.
- Verificado en navegador con la PGlite local: 11 grupos; compra múltiple en una fila; Personas = $65.000; F2-001 venta $95.300 y ganancia $4.700. Build, lint y 4 pruebas financieras correctos.
- La siguiente prioridad pasó a cuentas operativas y divisas antes de abordar préstamos.

### 2026-07-21 — Fase 4 completada: cuentas operativas y divisas
- Repriorizado el roadmap a pedido del usuario: antes de préstamos se completa la funcionalidad de las pantallas actuales.
- Alcance acordado: sidebar colapsable, creación de cuentas por tipo/moneda y compra/venta de divisas con cotización visible y doble entrada.
- El enum existente ya contempla ARS, USD, EUR, BRL, GBP, CHF, JPY, CNY, CAD, AUD, MXN y USDT; no hace falta ampliar el schema para ofrecerlas.
- Agregada alta de cuentas operativas por empresa, tipo contable y moneda; las cuentas aparecen inmediatamente en el mayor y los selectores.
- Agregada operación atómica `CURRENCY_EXCHANGE`: un grupo con salida de la cuenta origen, ingreso en la cuenta destino y actualización conjunta de ambos saldos.
- La UI distingue compra, venta y cruce según las monedas elegidas, muestra la convención de cotización, el monto que sale y el que entra antes de confirmar.
- Operaciones muestra ambos importes y la cotización; Cuentas formatea saldo y movimientos con la divisa real de cada cuenta.
- Verificado en navegador sobre PGlite real: sidebar colapsado/expandido; creación de `Caja USD`; compra de USD 10 entregando ARS 10.000 a cotización 1.000; venta de USD 4 recibiendo ARS 4.400 a cotización 1.100. Ambas quedaron agrupadas y visibles en Operaciones.
- Calidad: 7 pruebas financieras correctas (incluyen compra, venta y cruce de divisas), lint limpio y build de producción correcto.
- **Próximo:** definir y comenzar la Fase 5, préstamos y créditos con cuotas.
