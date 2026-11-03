CREATE TABLE `budget_exception` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_exception_cat_month` ON `budget_exception` (`category_id`,`month`);--> statement-breakpoint
CREATE TABLE `budget_line` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `budget_line_cat` ON `budget_line` (`category_id`);--> statement-breakpoint
CREATE TABLE `recurring` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`category_id` text,
	`amount` integer NOT NULL,
	`freq` text NOT NULL,
	`interval` integer DEFAULT 1 NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`pattern` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `category` ADD `rollover` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `category` ADD `bucket` text;--> statement-breakpoint
-- bases créées en phase 1 : classement 50/30/20 des catégories par défaut
UPDATE `category` SET `bucket` = 'besoin' WHERE `parent_id` IS NULL AND `name` IN ('Logement', 'Alimentation', 'Transport', 'Santé', 'Impôts & taxes', 'Frais bancaires');--> statement-breakpoint
UPDATE `category` SET `bucket` = 'envie' WHERE `parent_id` IS NULL AND `name` IN ('Loisirs', 'Abonnements', 'Shopping', 'Dons', 'Divers');--> statement-breakpoint
UPDATE `category` SET `bucket` = 'envie' WHERE `name` IN ('Restaurants', 'Livraison') AND `parent_id` IN (SELECT `id` FROM `category` WHERE `name` = 'Alimentation');
