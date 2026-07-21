ALTER TYPE "public"."operationType" ADD VALUE 'CHECK_DEPOSIT' BEFORE 'LOAN';--> statement-breakpoint
ALTER TYPE "public"."operationType" ADD VALUE 'CHECK_REJECTION' BEFORE 'LOAN';--> statement-breakpoint
ALTER TABLE "check" ADD COLUMN "depositDate" timestamp;--> statement-breakpoint
ALTER TABLE "check" ADD COLUMN "rejectionDate" timestamp;--> statement-breakpoint
ALTER TABLE "check" ADD COLUMN "rejectionReason" varchar(1000);--> statement-breakpoint
ALTER TABLE "check" ADD COLUMN "rejectedFromStatus" "checkStatus";--> statement-breakpoint
ALTER TABLE "check" ADD COLUMN "depositAccountId" uuid;--> statement-breakpoint
ALTER TABLE "check" ADD CONSTRAINT "check_depositAccountId_accountOnBusiness_id_fk" FOREIGN KEY ("depositAccountId") REFERENCES "public"."accountOnBusiness"("id") ON DELETE set null ON UPDATE no action;