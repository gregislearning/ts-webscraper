import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) environment variables are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Create tables for NBA Top Shot challenge data
 */
async function createTables() {
  console.log("Creating NBA Top Shot challenge tables...");

  try {
    // Create challenges table
    const { error: challengesError } = await supabase.rpc('create_challenges_table');
    
    if (challengesError && !challengesError.message.includes('already exists')) {
      console.error("Error creating challenges table:", challengesError);
      
      // Fallback: Try creating with raw SQL
      const challengesSQL = `
        CREATE TABLE IF NOT EXISTS challenges (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          url TEXT,
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
        
        -- Create index on title for faster searches
        CREATE INDEX IF NOT EXISTS idx_challenges_title ON challenges(title);
        
        -- Create index on scraped_at for chronological queries
        CREATE INDEX IF NOT EXISTS idx_challenges_scraped_at ON challenges(scraped_at);
        
        -- Create index on url for uniqueness checks
        CREATE INDEX IF NOT EXISTS idx_challenges_url ON challenges(url);
      `;
      
      const { error: sqlError } = await supabase.rpc('exec_sql', { sql: challengesSQL });
      if (sqlError) {
        console.error("Error creating challenges table with SQL:", sqlError);
      } else {
        console.log("✅ Challenges table created successfully");
      }
    } else {
      console.log("✅ Challenges table created successfully");
    }

    // Create required_cards table
    const requiredCardsSQL = `
      CREATE TABLE IF NOT EXISTS required_cards (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        rarity TEXT,
        type TEXT DEFAULT 'required_card',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Create index on challenge_id for faster joins
      CREATE INDEX IF NOT EXISTS idx_required_cards_challenge_id ON required_cards(challenge_id);
      
      -- Create index on title for searches
      CREATE INDEX IF NOT EXISTS idx_required_cards_title ON required_cards(title);
      
      -- Create index on rarity for filtering
      CREATE INDEX IF NOT EXISTS idx_required_cards_rarity ON required_cards(rarity);
    `;

    const { error: cardsError } = await supabase.rpc('exec_sql', { sql: requiredCardsSQL });
    if (cardsError && !cardsError.message.includes('already exists')) {
      console.error("Error creating required_cards table:", cardsError);
    } else {
      console.log("✅ Required cards table created successfully");
    }

    // Create a view for easy querying of challenges with their required cards
    const viewSQL = `
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
    `;

    const { error: viewError } = await supabase.rpc('exec_sql', { sql: viewSQL });
    if (viewError) {
      console.error("Error creating challenges_with_cards view:", viewError);
    } else {
      console.log("✅ Challenges with cards view created successfully");
    }

    // Create RLS (Row Level Security) policies if needed
    const rlsSQL = `
      -- Enable RLS on both tables
      ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
      ALTER TABLE required_cards ENABLE ROW LEVEL SECURITY;
      
      -- Create policies for public read access (adjust as needed for your security requirements)
      CREATE POLICY IF NOT EXISTS "Public read access for challenges" 
        ON challenges FOR SELECT 
        USING (true);
        
      CREATE POLICY IF NOT EXISTS "Public read access for required_cards" 
        ON required_cards FOR SELECT 
        USING (true);
        
      -- Create policies for authenticated insert/update (adjust as needed)
      CREATE POLICY IF NOT EXISTS "Authenticated insert for challenges" 
        ON challenges FOR INSERT 
        WITH CHECK (auth.role() = 'authenticated');
        
      CREATE POLICY IF NOT EXISTS "Authenticated insert for required_cards" 
        ON required_cards FOR INSERT 
        WITH CHECK (auth.role() = 'authenticated');
    `;

    const { error: rlsError } = await supabase.rpc('exec_sql', { sql: rlsSQL });
    if (rlsError) {
      console.warn("Warning: Could not set up RLS policies:", rlsError.message);
      console.log("You may need to set up Row Level Security policies manually in the Supabase dashboard");
    } else {
      console.log("✅ Row Level Security policies created successfully");
    }

    console.log("\n🎉 All tables created successfully!");
    console.log("\nTables created:");
    console.log("- challenges: Main challenge information");
    console.log("- required_cards: Cards required for each challenge");
    console.log("- challenges_with_cards: View combining both tables");
    
    console.log("\nNext steps:");
    console.log("1. Use insertChallengeData.js to populate the tables with your scraped data");
    console.log("2. Query the data using the challenges_with_cards view for complete information");

  } catch (error) {
    console.error("Unexpected error:", error);
  }
}

/**
 * Alternative method using direct SQL execution if RPC doesn't work
 */
async function createTablesWithDirectSQL() {
  console.log("Creating tables using direct SQL approach...");
  
  const fullSQL = `
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

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_challenges_title ON challenges(title);
    CREATE INDEX IF NOT EXISTS idx_challenges_scraped_at ON challenges(scraped_at);
    CREATE INDEX IF NOT EXISTS idx_challenges_url ON challenges(url);
    CREATE INDEX IF NOT EXISTS idx_required_cards_challenge_id ON required_cards(challenge_id);
    CREATE INDEX IF NOT EXISTS idx_required_cards_title ON required_cards(title);
    CREATE INDEX IF NOT EXISTS idx_required_cards_rarity ON required_cards(rarity);

    -- Create view
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
  `;

  try {
    // Note: This approach requires the SQL to be executed in the Supabase SQL editor
    // or using a service role key with elevated permissions
    console.log("SQL to execute in Supabase SQL editor:");
    console.log("=====================================");
    console.log(fullSQL);
    console.log("=====================================");
    
    console.log("\n📋 Instructions:");
    console.log("1. Copy the SQL above");
    console.log("2. Go to your Supabase dashboard > SQL Editor");
    console.log("3. Paste and run the SQL");
    console.log("4. Then run insertChallengeData.js to populate the tables");
    
  } catch (error) {
    console.error("Error:", error);
  }
}

// Main execution
async function main() {
  console.log("🚀 NBA Top Shot Challenge Tables Setup");
  console.log("=====================================\n");
  
  try {
    await createTables();
  } catch (error) {
    console.log("\n⚠️  Primary method failed, showing SQL for manual execution:");
    await createTablesWithDirectSQL();
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { createTables, createTablesWithDirectSQL }; 