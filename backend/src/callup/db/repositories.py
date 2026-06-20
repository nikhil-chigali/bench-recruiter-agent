"""All SQL lives here, including pgvector similarity queries.

Route handlers and worker tasks never write SQL directly — they call repository
functions. The retrieval funnel (freshness window + applied-exclusion + scope filter
combined with vector distance ORDER BY) is implemented here in Phase 3.
"""
