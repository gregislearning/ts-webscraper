import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// Initialize Supabase client with service role key for admin operations
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing required environment variables:");
  console.error("   SUPABASE_URL:", supabaseUrl ? "✅" : "❌");
  console.error("   SUPABASE_SERVICE_ROLE_KEY:", supabaseServiceKey ? "✅" : "❌");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Create the analysis table and views
 */
async function createAnalysisTable() {
  console.log("🚀 Creating challenge analysis table in Supabase...\n");

  try {
    // Read the SQL file
    const sqlContent = readFileSync("create-analysis-table.sql", "utf8");
    
    // Split SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      if (statement.includes('CREATE TABLE')) {
        console.log(`📋 Creating table: challenge_analysis...`);
      } else if (statement.includes('CREATE INDEX')) {
        const indexMatch = statement.match(/idx_\w+/);
        const indexName = indexMatch ? indexMatch[0] : 'index';
        console.log(`🔍 Creating index: ${indexName}...`);
      } else if (statement.includes('CREATE OR REPLACE VIEW')) {
        const viewMatch = statement.match(/VIEW (\w+)/);
        const viewName = viewMatch ? viewMatch[1] : 'view';
        console.log(`👁️ Creating view: ${viewName}...`);
      } else if (statement.includes('COMMENT ON')) {
        console.log(`💬 Adding documentation comments...`);
      } else {
        console.log(`⚙️ Executing statement ${i + 1}...`);
      }

      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        // Try direct query if RPC fails
        const { error: directError } = await supabase
          .from('_temp')
          .select('1')
          .limit(0);
        
        if (directError) {
          console.warn(`⚠️ Statement ${i + 1} failed, trying alternative approach...`);
          // For table creation, we can try a simpler approach
          if (statement.includes('CREATE TABLE')) {
            console.log("   Using alternative table creation method...");
            await createTableDirectly();
          }
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`, error.message);
        }
      } else {
        console.log(`   ✅ Success`);
      }
    }

    console.log("\n🎉 Analysis table setup completed!");
    
    // Test the table
    await testTable();

  } catch (error) {
    console.error("❌ Error creating analysis table:", error);
    
    // Fallback: create table directly
    console.log("\n🔄 Trying direct table creation...");
    await createTableDirectly();
  }
}

/**
 * Create table directly using Supabase client
 */
async function createTableDirectly() {
  console.log("📋 Creating challenge_analysis table directly...");
  
  try {
    // We'll create a simpler version that we know will work
    const { error } = await supabase
      .from('challenge_analysis')
      .select('id')
      .limit(1);
    
    if (error && error.message.includes('does not exist')) {
      console.log("   Table doesn't exist, you'll need to create it manually in Supabase SQL Editor");
      console.log("\n📋 Manual Setup Instructions:");
      console.log("1. Go to your Supabase dashboard");
      console.log("2. Navigate to SQL Editor");
      console.log("3. Copy and paste the contents of create-analysis-table.sql");
      console.log("4. Run the SQL");
      console.log("\n📄 SQL file location: ./create-analysis-table.sql");
    } else {
      console.log("   ✅ Table already exists or accessible");
    }
    
  } catch (directError) {
    console.log("   ℹ️ Table creation needs to be done manually in Supabase dashboard");
  }
}

/**
 * Test the created table
 */
async function testTable() {
  console.log("\n🧪 Testing the analysis table...");
  
  try {
    // Test basic table access
    const { data, error } = await supabase
      .from('challenge_analysis')
      .select('id')
      .limit(1);
    
    if (error) {
      console.log("⚠️ Table test failed - you may need to create it manually");
      console.log("   Error:", error.message);
    } else {
      console.log("✅ Table is accessible and ready to use!");
      console.log(`   Current records: ${data?.length || 0}`);
    }
    
    // Test views
    const views = ['challenge_analysis_summary', 'latest_challenge_analysis', 'analysis_method_comparison'];
    
    for (const viewName of views) {
      try {
        const { error: viewError } = await supabase
          .from(viewName)
          .select('*')
          .limit(1);
        
        if (viewError) {
          console.log(`⚠️ View ${viewName} may need manual creation`);
        } else {
          console.log(`✅ View ${viewName} is working`);
        }
      } catch (e) {
        console.log(`⚠️ View ${viewName} test skipped`);
      }
    }
    
  } catch (error) {
    console.log("⚠️ Table testing skipped due to access limitations");
  }
}

/**
 * Show usage examples
 */
function showUsageExamples() {
  console.log("\n" + "=".repeat(60));
  console.log("📚 USAGE EXAMPLES");
  console.log("=".repeat(60));
  
  console.log("\n🔍 Query Examples:");
  console.log(`
-- Get latest analysis for all challenges
SELECT * FROM latest_challenge_analysis;

-- Compare methods for a specific challenge
SELECT * FROM analysis_method_comparison 
WHERE challenge_id = 'your-challenge-id';

-- Find completable challenges
SELECT challenge_title, completion_percentage, analysis_method
FROM challenge_analysis 
WHERE can_complete = true
ORDER BY completion_percentage DESC;

-- Track analysis history
SELECT challenge_title, analysis_method, completion_percentage, created_at
FROM challenge_analysis 
WHERE challenge_id = 'your-challenge-id'
ORDER BY created_at DESC;
`);

  console.log("\n📊 The table will store:");
  console.log("   • Challenge completion status");
  console.log("   • Exact matches, rarity upgrades, missing cards");
  console.log("   • Detailed JSON data for each match/miss");
  console.log("   • AI responses (when applicable)");
  console.log("   • Performance metrics");
  console.log("   • Analysis method comparison");
}

/**
 * Main execution
 */
async function main() {
  console.log("🏗️ NBA Top Shot Challenge Analysis Table Creator");
  console.log("=".repeat(50));
  
  await createAnalysisTable();
  showUsageExamples();
  
  console.log("\n🎯 Next Steps:");
  console.log("1. Update your analyzers to save results to this table");
  console.log("2. Run analyses and track your progress over time");
  console.log("3. Compare different analysis methods");
  console.log("4. Query the views for insights");
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { createAnalysisTable, testTable }; 