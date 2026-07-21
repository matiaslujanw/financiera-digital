import { createCallerFactory, createTRPCRouter } from "./trpc";
import { guildRouter } from "./router/guild";
import { businessRouter } from "./router/business";
import { dictionaryAccountRouter } from "./router/dictionaryAccount";
import { accountOnBusinessRouter } from "./router/accountOnBusiness";
import { transactionRouter } from "./router/transaction";
import { checkRouter } from "./router/check";

export const appRouter = createTRPCRouter({
	guild: guildRouter,
	business: businessRouter,
	dictionaryAccount: dictionaryAccountRouter,
	accountOnBusiness: accountOnBusinessRouter,
	transaction: transactionRouter,
	check: checkRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
