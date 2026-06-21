"""Job ingestion: pull postings from Dice and normalize them into clean, deduped,
embedded records (emit embed_text, content_hash, apply_type, and the three timestamps;
upsert keyed on (source, position_id))."""
