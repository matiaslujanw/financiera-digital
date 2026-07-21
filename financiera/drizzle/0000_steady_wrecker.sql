CREATE TYPE "public"."accountType" AS ENUM('ASSET', 'EXPENSE', 'LIABILITY', 'REVENUE');--> statement-breakpoint
CREATE TYPE "public"."action" AS ENUM('CREATE', 'READ', 'UPDATE', 'DELETE');--> statement-breakpoint
CREATE TYPE "public"."checkStatus" AS ENUM('REJECTED', 'DEPOSITED', 'SOLD', 'PURCHASED');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('ARS', 'USD', 'EUR', 'CNY', 'AUD', 'GBP', 'BRL', 'CAD', 'JPY', 'CHF', 'USDT', 'MXN');--> statement-breakpoint
CREATE TYPE "public"."entityType" AS ENUM('PERSON', 'MACHINERY', 'VEHICLE', 'PROPERTY');--> statement-breakpoint
CREATE TYPE "public"."installmentParentType" AS ENUM('LOAN', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."installmentStatus" AS ENUM('PENDING', 'PAID', 'PARTIALLY_PAID', 'CANCELLED', 'OVERDUE', 'SETTLED_EARLY');--> statement-breakpoint
CREATE TYPE "public"."loanStatus" AS ENUM('ACTIVE', 'PAID_OFF', 'DEFAULTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."notificationType" AS ENUM('LOAN_DUE_SOON', 'CREDIT_DUE_SOON', 'SYSTEM_ANNOUNCEMENT');--> statement-breakpoint
CREATE TYPE "public"."operationType" AS ENUM('CHECK_SALE', 'CHECK_PURCHASE', 'LOAN', 'CREDIT', 'CABLE', 'CURRENCY_EXCHANGE', 'REGULAR', 'MULTIPLE');--> statement-breakpoint
CREATE TYPE "public"."paymentPeriodicity" AS ENUM('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'ANNUALLY');--> statement-breakpoint
CREATE TYPE "public"."resourceType" AS ENUM('GUILD', 'BUSINESS', 'DICTIONARY_ACCOUNT', 'ACCOUNT', 'TRANSACTION', 'CATEGORY', 'CHECK', 'CABLE', 'LOAN', 'CREDIT', 'PERSON', 'VEHICLE', 'MACHINERY', 'PROPERTY', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('OWNER', 'MANAGER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('SUCCESS', 'PENDING', 'CANCELLED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."transactionType" AS ENUM('DEBIT', 'CREDIT');--> statement-breakpoint
CREATE TABLE "accountOnBusiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"discharged" boolean DEFAULT true NOT NULL,
	"businessId" uuid NOT NULL,
	"dictionaryAccountId" uuid NOT NULL,
	"name" varchar(255),
	"subAccount" boolean DEFAULT false NOT NULL,
	"personId" uuid,
	"machineryId" uuid,
	"vehicleId" uuid,
	"propertyId" uuid,
	"currentBalance" numeric DEFAULT '0',
	"lastTransactionDate" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "business" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"businessSlug" varchar(255) NOT NULL,
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL,
	"image" varchar(255) DEFAULT 'https://www.svgrepo.com/show/477000/ocean.svg'
);
--> statement-breakpoint
CREATE TABLE "cable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"amount" numeric NOT NULL,
	"serviceFeeRate" numeric NOT NULL,
	"serviceFeeAmount" numeric NOT NULL,
	"about" varchar(255),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL,
	"businessId" uuid NOT NULL,
	"memberId" uuid NOT NULL,
	"personId" uuid
);
--> statement-breakpoint
CREATE TABLE "cableOnTransactionGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"cableId" uuid NOT NULL,
	"transactionGroupId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categoriesOnDictionaryAccount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"categoryId" uuid NOT NULL,
	"dictionaryAccountId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"about" varchar(255),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatMessage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"chatRoomId" uuid NOT NULL,
	"senderId" uuid NOT NULL,
	"content" text NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatParticipant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatRoomId" uuid NOT NULL,
	"memberId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chatRoom" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"guildSlug" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"purchaseDate" timestamp,
	"saleDate" timestamp,
	"buyerPersonId" uuid,
	"collectionDate" timestamp NOT NULL,
	"serviceFeeRate" numeric NOT NULL,
	"monthlyInterestRate" numeric NOT NULL,
	"carriedInterestRate" numeric NOT NULL,
	"bankClearing" integer,
	"saleServiceFeeRate" numeric,
	"saleMonthlyInterestRate" numeric,
	"saleCarriedInterestRate" numeric,
	"saleGrossValue" numeric,
	"saleNetValue" numeric,
	"saleServiceFeeAmount" numeric,
	"saleInterestRateAmount" numeric,
	"grossValue" numeric NOT NULL,
	"netValue" numeric NOT NULL,
	"serviceFeeAmount" numeric NOT NULL,
	"interestRateAmount" numeric NOT NULL,
	"currency" "currency" NOT NULL,
	"checkWriter" text NOT NULL,
	"checkNumber" text,
	"bankName" text,
	"about" varchar(255),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL,
	"businessId" uuid NOT NULL,
	"memberId" uuid NOT NULL,
	"personId" uuid,
	"status" "checkStatus" DEFAULT 'PURCHASED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkOnTransactionGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"checkId" uuid NOT NULL,
	"transactionGroupId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guildSlug" varchar NOT NULL,
	"businessId" uuid NOT NULL,
	"memberId" uuid NOT NULL,
	"personId" uuid,
	"purchaseDate" timestamp NOT NULL,
	"currency" "currency" NOT NULL,
	"collectionDate" timestamp NOT NULL,
	"grossValue" numeric NOT NULL,
	"totalInterestAmount" numeric NOT NULL,
	"totalCreditValue" numeric NOT NULL,
	"numberOfInstallments" integer NOT NULL,
	"paymentPeriodicity" "paymentPeriodicity" NOT NULL,
	"paidInterest" numeric DEFAULT '0',
	"status" "loanStatus" DEFAULT 'ACTIVE' NOT NULL,
	"about" varchar(255),
	"alertsConfig" jsonb DEFAULT '{"leadTimes":[]}'::jsonb,
	"discharged" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "creditOnTransactionGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"creditId" uuid NOT NULL,
	"transactionGroupId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionaryAccount" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"checkAccount" boolean DEFAULT false NOT NULL,
	"availability" boolean DEFAULT false NOT NULL,
	"hasSubAccounts" boolean DEFAULT false NOT NULL,
	"accountType" "accountType" NOT NULL,
	"currency" "currency" NOT NULL,
	"guildSlug" varchar NOT NULL,
	"discharged" boolean DEFAULT true NOT NULL,
	"slug" varchar(255) NOT NULL,
	"entityType" "entityType"
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"about" varchar(255),
	"discharged" boolean DEFAULT true NOT NULL,
	"transactionId" uuid NOT NULL,
	"categoryId" uuid,
	"amount" numeric,
	"date" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guild" (
	"guildSlug" varchar(255) PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"discharged" boolean DEFAULT true NOT NULL,
	"image" varchar(255) DEFAULT 'https://www.svgrepo.com/show/476998/village.svg'
);
--> statement-breakpoint
CREATE TABLE "installment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"parentType" "installmentParentType" DEFAULT 'LOAN' NOT NULL,
	"loanId" uuid,
	"creditId" uuid,
	"installmentNumber" integer NOT NULL,
	"dueDate" timestamp NOT NULL,
	"principalAmount" numeric DEFAULT '0' NOT NULL,
	"interestAmount" numeric NOT NULL,
	"totalAmount" numeric NOT NULL,
	"paidAmount" numeric DEFAULT '0',
	"paidDate" timestamp,
	"status" "installmentStatus" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"paymentTransactionId" uuid
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"expiresAt" timestamp,
	"guildSlug" varchar NOT NULL,
	"email" varchar NOT NULL,
	"userId" uuid,
	"role" "role" DEFAULT 'MEMBER' NOT NULL,
	"discharged" boolean DEFAULT true NOT NULL,
	"status" "status" DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guildSlug" varchar NOT NULL,
	"businessId" uuid NOT NULL,
	"memberId" uuid NOT NULL,
	"personId" uuid,
	"purchaseDate" timestamp NOT NULL,
	"currency" "currency" NOT NULL,
	"collectionDate" timestamp NOT NULL,
	"grossValue" numeric NOT NULL,
	"totalInterestAmount" numeric NOT NULL,
	"totalLoanValue" numeric NOT NULL,
	"numberOfInstallments" integer NOT NULL,
	"paymentPeriodicity" "paymentPeriodicity" NOT NULL,
	"principalPerInstallment" numeric,
	"interestPerInstallment" numeric,
	"paidPrincipal" numeric DEFAULT '0',
	"paidInterest" numeric DEFAULT '0',
	"remainingPrincipal" numeric,
	"status" "loanStatus" DEFAULT 'ACTIVE' NOT NULL,
	"guaranteeDetails" text,
	"about" varchar(255),
	"alertsConfig" jsonb DEFAULT '{"leadTimes":[]}'::jsonb,
	"discharged" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "loanOnTransactionGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"loanId" uuid NOT NULL,
	"transactionGroupId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"entityName" varchar NOT NULL,
	"entityId" varchar NOT NULL,
	"action" varchar NOT NULL,
	"quantity" integer,
	"details" jsonb,
	"userId" uuid NOT NULL,
	"guildSlug" varchar NOT NULL,
	"businessId" uuid
);
--> statement-breakpoint
CREATE TABLE "machinery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"image" varchar(255),
	"identifier" varchar,
	"brand" varchar(255),
	"model" varchar(255),
	"year" varchar(4),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"role" "role" DEFAULT 'MEMBER' NOT NULL,
	"discharged" boolean DEFAULT true NOT NULL,
	"userId" uuid NOT NULL,
	"guildSlug" varchar NOT NULL,
	"status" "status" DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberOnAccountOnBusiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"memberOnBusinessId" uuid NOT NULL,
	"accountOnBusinessId" uuid NOT NULL,
	"canRead" boolean DEFAULT true NOT NULL,
	"canWrite" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberOnBusiness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"memberId" uuid NOT NULL,
	"businessId" uuid NOT NULL,
	"hasFullAccess" boolean DEFAULT false NOT NULL,
	"canWrite" boolean DEFAULT false NOT NULL,
	"canViewOperations" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"memberId" uuid NOT NULL,
	"guildSlug" varchar NOT NULL,
	"type" "notificationType" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"relatedUrl" varchar(255),
	"scheduledFor" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"image" varchar(255),
	"identifier" varchar,
	"identifierType" varchar(255),
	"email" varchar(255),
	"phone" varchar(50),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL,
	"userId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"image" varchar(255),
	"identifier" varchar,
	"address" varchar(255),
	"type" varchar(255),
	"size" numeric,
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"date" timestamp NOT NULL,
	"amount" numeric NOT NULL,
	"balance" numeric,
	"exchangeRate" numeric,
	"about" varchar(255),
	"discharged" boolean DEFAULT true NOT NULL,
	"transactionType" "transactionType" NOT NULL,
	"transactionGroupId" uuid,
	"fromAccountId" uuid,
	"toAccountId" uuid NOT NULL,
	"memberId" uuid NOT NULL,
	"categoryId" uuid,
	"personId" uuid,
	"history" json DEFAULT '[]'::json,
	"requiresSignature" boolean DEFAULT false NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"signature" text,
	"accessToken" uuid DEFAULT gen_random_uuid()
);
--> statement-breakpoint
CREATE TABLE "transactionGroup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"description" varchar(1000),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL,
	"businessId" uuid,
	"operationType" "operationType" DEFAULT 'REGULAR' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"email" text NOT NULL,
	"firstname" text,
	"lastname" text,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	"name" varchar(255) NOT NULL,
	"image" varchar(255),
	"identifier" varchar,
	"purchaseDate" timestamp DEFAULT now(),
	"about" text,
	"mileage" numeric,
	"brand" varchar(255),
	"model" varchar(255),
	"year" varchar(4),
	"discharged" boolean DEFAULT true NOT NULL,
	"guildSlug" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authUser" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "authUser_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accountOnBusiness" ADD CONSTRAINT "accountOnBusiness_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountOnBusiness" ADD CONSTRAINT "accountOnBusiness_dictionaryAccountId_dictionaryAccount_id_fk" FOREIGN KEY ("dictionaryAccountId") REFERENCES "public"."dictionaryAccount"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountOnBusiness" ADD CONSTRAINT "accountOnBusiness_personId_person_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountOnBusiness" ADD CONSTRAINT "accountOnBusiness_machineryId_machinery_id_fk" FOREIGN KEY ("machineryId") REFERENCES "public"."machinery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountOnBusiness" ADD CONSTRAINT "accountOnBusiness_vehicleId_vehicle_id_fk" FOREIGN KEY ("vehicleId") REFERENCES "public"."vehicle"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accountOnBusiness" ADD CONSTRAINT "accountOnBusiness_propertyId_property_id_fk" FOREIGN KEY ("propertyId") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable" ADD CONSTRAINT "cable_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable" ADD CONSTRAINT "cable_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cable" ADD CONSTRAINT "cable_personId_person_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cableOnTransactionGroup" ADD CONSTRAINT "cableOnTransactionGroup_cableId_cable_id_fk" FOREIGN KEY ("cableId") REFERENCES "public"."cable"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cableOnTransactionGroup" ADD CONSTRAINT "cableOnTransactionGroup_transactionGroupId_transactionGroup_id_fk" FOREIGN KEY ("transactionGroupId") REFERENCES "public"."transactionGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoriesOnDictionaryAccount" ADD CONSTRAINT "categoriesOnDictionaryAccount_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categoriesOnDictionaryAccount" ADD CONSTRAINT "categoriesOnDictionaryAccount_dictionaryAccountId_dictionaryAccount_id_fk" FOREIGN KEY ("dictionaryAccountId") REFERENCES "public"."dictionaryAccount"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatMessage" ADD CONSTRAINT "chatMessage_chatRoomId_chatRoom_id_fk" FOREIGN KEY ("chatRoomId") REFERENCES "public"."chatRoom"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatMessage" ADD CONSTRAINT "chatMessage_senderId_member_id_fk" FOREIGN KEY ("senderId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatParticipant" ADD CONSTRAINT "chatParticipant_chatRoomId_chatRoom_id_fk" FOREIGN KEY ("chatRoomId") REFERENCES "public"."chatRoom"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatParticipant" ADD CONSTRAINT "chatParticipant_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chatRoom" ADD CONSTRAINT "chatRoom_guildSlug_guild_guildSlug_fk" FOREIGN KEY ("guildSlug") REFERENCES "public"."guild"("guildSlug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check" ADD CONSTRAINT "check_buyerPersonId_person_id_fk" FOREIGN KEY ("buyerPersonId") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check" ADD CONSTRAINT "check_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check" ADD CONSTRAINT "check_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check" ADD CONSTRAINT "check_personId_person_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkOnTransactionGroup" ADD CONSTRAINT "checkOnTransactionGroup_checkId_check_id_fk" FOREIGN KEY ("checkId") REFERENCES "public"."check"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkOnTransactionGroup" ADD CONSTRAINT "checkOnTransactionGroup_transactionGroupId_transactionGroup_id_fk" FOREIGN KEY ("transactionGroupId") REFERENCES "public"."transactionGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit" ADD CONSTRAINT "credit_guildSlug_guild_guildSlug_fk" FOREIGN KEY ("guildSlug") REFERENCES "public"."guild"("guildSlug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit" ADD CONSTRAINT "credit_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit" ADD CONSTRAINT "credit_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit" ADD CONSTRAINT "credit_personId_person_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditOnTransactionGroup" ADD CONSTRAINT "creditOnTransactionGroup_creditId_credit_id_fk" FOREIGN KEY ("creditId") REFERENCES "public"."credit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creditOnTransactionGroup" ADD CONSTRAINT "creditOnTransactionGroup_transactionGroupId_transactionGroup_id_fk" FOREIGN KEY ("transactionGroupId") REFERENCES "public"."transactionGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_transactionId_transaction_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_loanId_loan_id_fk" FOREIGN KEY ("loanId") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_creditId_credit_id_fk" FOREIGN KEY ("creditId") REFERENCES "public"."credit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment" ADD CONSTRAINT "installment_paymentTransactionId_transaction_id_fk" FOREIGN KEY ("paymentTransactionId") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_guildSlug_guild_guildSlug_fk" FOREIGN KEY ("guildSlug") REFERENCES "public"."guild"("guildSlug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_personId_person_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loanOnTransactionGroup" ADD CONSTRAINT "loanOnTransactionGroup_loanId_loan_id_fk" FOREIGN KEY ("loanId") REFERENCES "public"."loan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loanOnTransactionGroup" ADD CONSTRAINT "loanOnTransactionGroup_transactionGroupId_transactionGroup_id_fk" FOREIGN KEY ("transactionGroupId") REFERENCES "public"."transactionGroup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberOnAccountOnBusiness" ADD CONSTRAINT "memberOnAccountOnBusiness_memberOnBusinessId_memberOnBusiness_id_fk" FOREIGN KEY ("memberOnBusinessId") REFERENCES "public"."memberOnBusiness"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberOnAccountOnBusiness" ADD CONSTRAINT "memberOnAccountOnBusiness_accountOnBusinessId_accountOnBusiness_id_fk" FOREIGN KEY ("accountOnBusinessId") REFERENCES "public"."accountOnBusiness"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberOnBusiness" ADD CONSTRAINT "memberOnBusiness_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberOnBusiness" ADD CONSTRAINT "memberOnBusiness_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petition" ADD CONSTRAINT "petition_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_transactionGroupId_transactionGroup_id_fk" FOREIGN KEY ("transactionGroupId") REFERENCES "public"."transactionGroup"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_fromAccountId_accountOnBusiness_id_fk" FOREIGN KEY ("fromAccountId") REFERENCES "public"."accountOnBusiness"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_toAccountId_accountOnBusiness_id_fk" FOREIGN KEY ("toAccountId") REFERENCES "public"."accountOnBusiness"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_memberId_member_id_fk" FOREIGN KEY ("memberId") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_categoryId_category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_personId_person_id_fk" FOREIGN KEY ("personId") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactionGroup" ADD CONSTRAINT "transactionGroup_businessId_business_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."business"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_id_authUser_id_fk" FOREIGN KEY ("id") REFERENCES "public"."authUser"("id") ON DELETE cascade ON UPDATE no action;