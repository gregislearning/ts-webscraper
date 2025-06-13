-- NBA Top Shot Challenge Tables
-- Run this SQL in your Supabase SQL Editor

-- Create challenges table
CREATE TABLE IF NOT EXISTS challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT UNIQUE,
  full_url TEXT,
  countdown_days INTEGER,
  countdown_hours INTEGER,
  countdown_minutes INTEGER,
  countdown_seconds INTEGER,
  countdown_formatted TEXT,
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create required_cards table
CREATE TABLE IF NOT EXISTS required_cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rarity TEXT,
  type TEXT DEFAULT 'required_card',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_challenges_title ON challenges(title);
CREATE INDEX IF NOT EXISTS idx_challenges_scraped_at ON challenges(scraped_at);
CREATE INDEX IF NOT EXISTS idx_challenges_url ON challenges(url);
CREATE INDEX IF NOT EXISTS idx_required_cards_challenge_id ON required_cards(challenge_id);
CREATE INDEX IF NOT EXISTS idx_required_cards_title ON required_cards(title);
CREATE INDEX IF NOT EXISTS idx_required_cards_rarity ON required_cards(rarity);

-- Create a view that combines challenges with their required cards
CREATE OR REPLACE VIEW challenges_with_cards AS
SELECT 
  c.*,
  COALESCE(
    json_agg(
      json_build_object(
        'id', rc.id,
        'title', rc.title,
        'rarity', rc.rarity,
        'type', rc.type
      )
    ) FILTER (WHERE rc.id IS NOT NULL),
    '[]'::json
  ) as required_cards
FROM challenges c
LEFT JOIN required_cards rc ON c.id = rc.challenge_id
GROUP BY c.id;

-- Enable Row Level Security (optional - adjust policies as needed)
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE required_cards ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY IF NOT EXISTS "Public read access for challenges" 
  ON challenges FOR SELECT 
  USING (true);
  
CREATE POLICY IF NOT EXISTS "Public read access for required_cards" 
  ON required_cards FOR SELECT 
  USING (true);

-- Create policies for authenticated insert/update
CREATE POLICY IF NOT EXISTS "Authenticated insert for challenges" 
  ON challenges FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');
  
CREATE POLICY IF NOT EXISTS "Authenticated insert for required_cards" 
  ON required_cards FOR INSERT 
  WITH CHECK (auth.role() = 'authenticated');

-- Create policies for authenticated update
CREATE POLICY IF NOT EXISTS "Authenticated update for challenges" 
  ON challenges FOR UPDATE 
  USING (auth.role() = 'authenticated');

-- Create policies for authenticated delete
CREATE POLICY IF NOT EXISTS "Authenticated delete for challenges" 
  ON challenges FOR DELETE 
  USING (auth.role() = 'authenticated');

-- Add some helpful comments
COMMENT ON TABLE challenges IS 'NBA Top Shot challenges scraped from the website';
COMMENT ON TABLE required_cards IS 'Cards required to complete each challenge';
COMMENT ON VIEW challenges_with_cards IS 'Challenges with their required cards as JSON array';

COMMENT ON COLUMN challenges.title IS 'Challenge title/name';
COMMENT ON COLUMN challenges.description IS 'Challenge description text';
COMMENT ON COLUMN challenges.url IS 'Relative URL path to the challenge';
COMMENT ON COLUMN challenges.full_url IS 'Complete URL to the challenge page';
COMMENT ON COLUMN challenges.countdown_days IS 'Days remaining in countdown';
COMMENT ON COLUMN challenges.countdown_hours IS 'Hours remaining in countdown';
COMMENT ON COLUMN challenges.countdown_minutes IS 'Minutes remaining in countdown';
COMMENT ON COLUMN challenges.countdown_seconds IS 'Seconds remaining in countdown';
COMMENT ON COLUMN challenges.countdown_formatted IS 'Human-readable countdown format';
COMMENT ON COLUMN challenges.scraped_at IS 'When this challenge data was scraped';

COMMENT ON COLUMN required_cards.challenge_id IS 'Foreign key to challenges table';
COMMENT ON COLUMN required_cards.title IS 'Card/moment title or player name';
COMMENT ON COLUMN required_cards.rarity IS 'Card rarity or requirement description';
COMMENT ON COLUMN required_cards.type IS 'Type of requirement (usually "required_card")';

-- Create a function to get challenge statistics
CREATE OR REPLACE FUNCTION get_challenge_stats()
RETURNS TABLE (
  total_challenges BIGINT,
  total_required_cards BIGINT,
  avg_cards_per_challenge NUMERIC,
  most_recent_scrape TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM challenges) as total_challenges,
    (SELECT COUNT(*) FROM required_cards) as total_required_cards,
    (SELECT ROUND(AVG(card_count), 2) FROM (
      SELECT COUNT(rc.id) as card_count 
      FROM challenges c 
      LEFT JOIN required_cards rc ON c.id = rc.challenge_id 
      GROUP BY c.id
    ) subq) as avg_cards_per_challenge,
    (SELECT MAX(scraped_at) FROM challenges) as most_recent_scrape;
END;
$$ LANGUAGE plpgsql;

-- Example queries you can run after inserting data:

-- Get all challenges with their required cards count
-- SELECT title, description, countdown_formatted, 
--        (SELECT COUNT(*) FROM required_cards WHERE challenge_id = c.id) as card_count
-- FROM challenges c
-- ORDER BY scraped_at DESC;

-- Get challenges that require specific cards
-- SELECT DISTINCT c.title, c.description
-- FROM challenges c
-- JOIN required_cards rc ON c.id = rc.challenge_id
-- WHERE rc.title ILIKE '%Shai%' OR rc.title ILIKE '%Pascal%';

-- Get challenge statistics
-- SELECT * FROM get_challenge_stats();

-- Use the view to get complete challenge data
-- SELECT * FROM challenges_with_cards ORDER BY scraped_at DESC LIMIT 5; 