CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`data` blob NOT NULL,
	`ocr_text` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `category` ADD `fiscal` text;--> statement-breakpoint
ALTER TABLE `transaction` ADD `pro` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transaction` ADD `vat_rate` real;--> statement-breakpoint
ALTER TABLE `transaction` ADD `expense_report` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- catégories utiles au récapitulatif fiscal (bases créées avant cette version)
UPDATE `category` SET `fiscal` = 'don' WHERE `name` = 'Dons' AND `parent_id` IS NULL;--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `color`, `bucket`) SELECT lower(hex(randomblob(16))), 'Famille', 'depense', '#0d9488', 'besoin' WHERE NOT EXISTS (SELECT 1 FROM `category` WHERE `name` = 'Famille' AND `parent_id` IS NULL);--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `color`, `parent_id`, `fiscal`) SELECT lower(hex(randomblob(16))), 'Garde d’enfants', 'depense', '#0d9488', (SELECT `id` FROM `category` WHERE `name` = 'Famille' AND `parent_id` IS NULL), 'garde' WHERE NOT EXISTS (SELECT 1 FROM `category` WHERE `fiscal` = 'garde');--> statement-breakpoint
INSERT INTO `category` (`id`, `name`, `kind`, `color`, `parent_id`, `fiscal`) SELECT lower(hex(randomblob(16))), 'Emploi à domicile', 'depense', '#0d9488', (SELECT `id` FROM `category` WHERE `name` = 'Famille' AND `parent_id` IS NULL), 'domicile' WHERE NOT EXISTS (SELECT 1 FROM `category` WHERE `fiscal` = 'domicile');
