import "server-only";

import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { headers } from "next/headers";
import { cache } from "react";

import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { makeQueryClient } from "./query-client";

// Un query client por request (cache de React).
export const getQueryClient = cache(makeQueryClient);

const createContext = cache(async () => {
	const heads = new Headers(await headers());
	heads.set("x-trpc-source", "rsc");
	return createTRPCContext({ headers: heads });
});

export const trpc = createTRPCOptionsProxy({
	ctx: createContext,
	router: appRouter,
	queryClient: getQueryClient,
});

export function HydrateClient(props: { children: React.ReactNode }) {
	const queryClient = getQueryClient();
	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			{props.children}
		</HydrationBoundary>
	);
}

// Prefetch en RSC (soporta queries normales e infinitas).
export function prefetch<T extends { queryKey: readonly unknown[] }>(
	queryOptions: T,
) {
	const queryClient = getQueryClient();
	if (
		(queryOptions.queryKey[1] as { type?: string } | undefined)?.type ===
		"infinite"
	) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		void queryClient.prefetchInfiniteQuery(queryOptions as any);
	} else {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		void queryClient.prefetchQuery(queryOptions as any);
	}
}
