SELECT state, wait_event_type, wait_event, left(query, 120)
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid();
