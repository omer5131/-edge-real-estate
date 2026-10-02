CREATE TABLE IF NOT EXISTS yad2_publication_cache (
 market text NOT NULL CHECK(market IN ('sale','rent')), listing_id text NOT NULL,
 data jsonb NOT NULL, checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(market,listing_id)
);
COMMENT ON TABLE yad2_publication_cache IS 'One-time detail/date validation cache, including old or undated listings excluded from research. Not a recent-listings dataset.';
