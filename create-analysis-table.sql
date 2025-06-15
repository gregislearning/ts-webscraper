-- Create table to store challenge analysis results
CREATE TABLE IF NOT EXISTS challenge_analysis (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Challenge information
    challenge_id TEXT NOT NULL,
    challenge_title TEXT NOT NULL,
    challenge_scraped_at TIMESTAMP WITH TIME ZONE,
    
    -- Analysis metadata
    analysis_method TEXT NOT NULL, -- 'openai', 'huggingface', 'ollama', 'rule_based'
    analyzer_version TEXT DEFAULT '1.0',
    library_size INTEGER NOT NULL,
    
    -- Results summary
    can_complete BOOLEAN NOT NULL,
    completion_percentage INTEGER NOT NULL CHECK (completion_percentage >= 0 AND completion_percentage <= 100),
    total_required_cards INTEGER NOT NULL,
    exact_matches INTEGER DEFAULT 0,
    rarity_upgrades INTEGER DEFAULT 0,
    potential_matches INTEGER DEFAULT 0,
    missing_cards INTEGER DEFAULT 0,
    
    -- Detailed analysis (JSON)
    matching_cards JSONB DEFAULT '[]',
    missing_cards_details JSONB DEFAULT '[]',
    potential_matches_details JSONB DEFAULT '[]',
    
    -- AI response (if applicable)
    ai_raw_response TEXT,
    
    -- Summary and recommendations
    analysis_summary TEXT,
    recommendations JSONB DEFAULT '[]',
    
    -- Performance tracking
    analysis_duration_ms INTEGER
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_challenge_analysis_challenge_id ON challenge_analysis(challenge_id);
CREATE INDEX IF NOT EXISTS idx_challenge_analysis_method ON challenge_analysis(analysis_method);
CREATE INDEX IF NOT EXISTS idx_challenge_analysis_completion ON challenge_analysis(completion_percentage DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_analysis_created_at ON challenge_analysis(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_analysis_can_complete ON challenge_analysis(can_complete);

-- Create a view for easy analysis comparison
CREATE OR REPLACE VIEW challenge_analysis_summary AS
SELECT 
    challenge_id,
    challenge_title,
    analysis_method,
    can_complete,
    completion_percentage,
    exact_matches,
    rarity_upgrades,
    missing_cards,
    analysis_summary,
    created_at,
    ROW_NUMBER() OVER (PARTITION BY challenge_id ORDER BY created_at DESC) as analysis_rank
FROM challenge_analysis
ORDER BY challenge_id, created_at DESC;

-- Create a view for the latest analysis of each challenge
CREATE OR REPLACE VIEW latest_challenge_analysis AS
SELECT *
FROM challenge_analysis_summary
WHERE analysis_rank = 1;

-- Create a view for method comparison
CREATE OR REPLACE VIEW analysis_method_comparison AS
SELECT 
    challenge_id,
    challenge_title,
    MAX(CASE WHEN analysis_method = 'rule_based' THEN completion_percentage END) as rule_based_completion,
    MAX(CASE WHEN analysis_method = 'openai' THEN completion_percentage END) as openai_completion,
    MAX(CASE WHEN analysis_method = 'huggingface' THEN completion_percentage END) as huggingface_completion,
    MAX(CASE WHEN analysis_method = 'ollama' THEN completion_percentage END) as ollama_completion,
    BOOL_OR(CASE WHEN analysis_method = 'rule_based' THEN can_complete END) as rule_based_can_complete,
    BOOL_OR(CASE WHEN analysis_method = 'openai' THEN can_complete END) as openai_can_complete,
    BOOL_OR(CASE WHEN analysis_method = 'huggingface' THEN can_complete END) as huggingface_can_complete,
    BOOL_OR(CASE WHEN analysis_method = 'ollama' THEN can_complete END) as ollama_can_complete,
    COUNT(DISTINCT analysis_method) as methods_tested,
    MAX(created_at) as last_analyzed
FROM challenge_analysis
GROUP BY challenge_id, challenge_title
ORDER BY last_analyzed DESC;

-- Add RLS (Row Level Security) if needed
-- ALTER TABLE challenge_analysis ENABLE ROW LEVEL SECURITY;

-- Add comments for documentation
COMMENT ON TABLE challenge_analysis IS 'Stores results from NBA Top Shot challenge analysis using different methods';
COMMENT ON COLUMN challenge_analysis.analysis_method IS 'Method used: openai, huggingface, ollama, rule_based';
COMMENT ON COLUMN challenge_analysis.matching_cards IS 'JSON array of cards that match requirements';
COMMENT ON COLUMN challenge_analysis.missing_cards_details IS 'JSON array of missing cards with reasons';
COMMENT ON COLUMN challenge_analysis.potential_matches_details IS 'JSON array of potential matches needing verification';
COMMENT ON VIEW challenge_analysis_summary IS 'Summary view with ranking of analyses per challenge';
COMMENT ON VIEW latest_challenge_analysis IS 'Most recent analysis for each challenge';
COMMENT ON VIEW analysis_method_comparison IS 'Compare completion rates across different analysis methods'; 