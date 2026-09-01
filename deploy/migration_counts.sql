SELECT 'shops' AS table_name, COUNT(*) AS count FROM shops
UNION ALL SELECT 'source_products', COUNT(*) FROM source_products
UNION ALL SELECT 'listing_drafts', COUNT(*) FROM listing_drafts
UNION ALL SELECT 'listing_variants', COUNT(*) FROM listing_variants
UNION ALL SELECT 'bulk_listing_batches', COUNT(*) FROM bulk_listing_batches
UNION ALL SELECT 'bulk_listing_batch_items', COUNT(*) FROM bulk_listing_batch_items
UNION ALL SELECT 'automation_candidates', COUNT(*) FROM automation_candidates
UNION ALL SELECT 'source_media', COUNT(*) FROM source_media
UNION ALL SELECT 'ozon_global_category_cache', COUNT(*) FROM ozon_global_category_cache;
