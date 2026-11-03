ALTER TABLE `transaction` ADD `planned_ref` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tx_planned_ref` ON `transaction` (`planned_ref`);