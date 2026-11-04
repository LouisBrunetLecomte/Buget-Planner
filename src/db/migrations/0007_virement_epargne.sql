ALTER TABLE `recurring` ADD `to_account_id` text REFERENCES account(id) ON DELETE set null;
