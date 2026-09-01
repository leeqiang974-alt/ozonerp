ALTER TABLE automation_candidates ALTER COLUMN rejection_reason TYPE TEXT;
ALTER TABLE listing_drafts ALTER COLUMN ozon_product_id TYPE BIGINT;
ALTER TABLE listing_drafts ALTER COLUMN quality_rating TYPE NUMERIC(6,2);
