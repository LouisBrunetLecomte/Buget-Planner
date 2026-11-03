CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `asset_value` (
	`asset_id` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`asset_id`, `date`),
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `debt` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`principal` integer NOT NULL,
	`rate` real NOT NULL,
	`payment` integer NOT NULL,
	`start_month` text NOT NULL,
	`extra_monthly` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target` integer NOT NULL,
	`deadline` text,
	`account_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `goal_contribution` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `savings_rule` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`goal_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scenario` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
