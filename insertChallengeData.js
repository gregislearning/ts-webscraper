import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Insert challenge data from JSON file into Supabase tables
 */
async function insertChallengeData(jsonFilePath) {
  console.log(`📁 Reading challenge data from: ${jsonFilePath}`);
  
  try {
    // Read and parse the JSON file
    const fileContent = fs.readFileSync(jsonFilePath, 'utf8');
    const challenges = JSON.parse(fileContent);
    
    console.log(`📊 Found ${challenges.length} challenges to insert`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < challenges.length; i++) {
      const challenge = challenges[i];
      console.log(`\n🔄 Processing challenge ${i + 1}/${challenges.length}: "${challenge.title}"`);
      
      try {
        // Prepare challenge data for insertion
        const challengeData = {
          title: challenge.title,
          description: challenge.description,
          url: challenge.url,
          full_url: challenge.fullUrl,
          countdown_days: challenge.countdown?.days || null,
          countdown_hours: challenge.countdown?.hours || null,
          countdown_minutes: challenge.countdown?.minutes || null,
          countdown_seconds: challenge.countdown?.seconds || null,
          countdown_formatted: challenge.countdown?.formatted || null,
          scraped_at: challenge.scrapedAt ? new Date(challenge.scrapedAt).toISOString() : null
        };
        
        // Insert challenge (use upsert to handle duplicates)
        const { data: insertedChallenge, error: challengeError } = await supabase
          .from('challenges')
          .upsert(challengeData, { 
            onConflict: 'url',
            ignoreDuplicates: false 
          })
          .select()
          .single();
        
        if (challengeError) {
          console.error(`❌ Error inserting challenge "${challenge.title}":`, challengeError);
          errorCount++;
          continue;
        }
        
        console.log(`✅ Challenge inserted with ID: ${insertedChallenge.id}`);
        
        // Insert required cards if they exist
        if (challenge.requiredCards && challenge.requiredCards.length > 0) {
          console.log(`   📋 Inserting ${challenge.requiredCards.length} required cards...`);
          
          // First, delete existing required cards for this challenge to avoid duplicates
          const { error: deleteError } = await supabase
            .from('required_cards')
            .delete()
            .eq('challenge_id', insertedChallenge.id);
          
          if (deleteError) {
            console.warn(`   ⚠️  Warning: Could not delete existing cards:`, deleteError);
          }
          
          // Prepare required cards data
          const cardsData = challenge.requiredCards.map(card => ({
            challenge_id: insertedChallenge.id,
            title: card.title,
            rarity: card.rarity,
            type: card.type || 'required_card'
          }));
          
          // Insert required cards
          const { error: cardsError } = await supabase
            .from('required_cards')
            .insert(cardsData);
          
          if (cardsError) {
            console.error(`   ❌ Error inserting required cards:`, cardsError);
            errorCount++;
          } else {
            console.log(`   ✅ ${cardsData.length} required cards inserted successfully`);
          }
        }
        
        successCount++;
        
      } catch (error) {
        console.error(`❌ Unexpected error processing challenge "${challenge.title}":`, error);
        errorCount++;
      }
    }
    
    console.log("\n🎉 Data insertion completed!");
    console.log(`✅ Successfully processed: ${successCount} challenges`);
    console.log(`❌ Errors encountered: ${errorCount} challenges`);
    
    // Show summary statistics
    await showDataSummary();
    
  } catch (error) {
    console.error("❌ Error reading or parsing JSON file:", error);
    throw error;
  }
}

/**
 * Show summary of data in the database
 */
async function showDataSummary() {
  console.log("\n📊 Database Summary:");
  console.log("===================");
  
  try {
    // Count challenges
    const { count: challengeCount, error: challengeCountError } = await supabase
      .from('challenges')
      .select('*', { count: 'exact', head: true });
    
    if (challengeCountError) {
      console.error("Error counting challenges:", challengeCountError);
    } else {
      console.log(`📋 Total challenges: ${challengeCount}`);
    }
    
    // Count required cards
    const { count: cardCount, error: cardCountError } = await supabase
      .from('required_cards')
      .select('*', { count: 'exact', head: true });
    
    if (cardCountError) {
      console.error("Error counting required cards:", cardCountError);
    } else {
      console.log(`🃏 Total required cards: ${cardCount}`);
    }
    
    // Show recent challenges
    const { data: recentChallenges, error: recentError } = await supabase
      .from('challenges')
      .select('title, scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(5);
    
    if (recentError) {
      console.error("Error fetching recent challenges:", recentError);
    } else {
      console.log("\n🕒 Most recent challenges:");
      recentChallenges.forEach((challenge, index) => {
        const scrapedDate = challenge.scraped_at ? new Date(challenge.scraped_at).toLocaleDateString() : 'Unknown';
        console.log(`   ${index + 1}. ${challenge.title} (${scrapedDate})`);
      });
    }
    
  } catch (error) {
    console.error("Error generating summary:", error);
  }
}

/**
 * Find and insert data from the most recent challenge file
 */
async function insertLatestChallengeFile() {
  const currentDir = process.cwd();
  
  try {
    // Find all challenge JSON files
    const files = fs.readdirSync(currentDir);
    const challengeFiles = files
      .filter(file => file.startsWith('challenges_') && file.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first
    
    if (challengeFiles.length === 0) {
      console.log("❌ No challenge JSON files found in current directory");
      console.log("Expected files like: challenges_2025-06-12.json");
      return;
    }
    
    const latestFile = challengeFiles[0];
    console.log(`🎯 Using latest challenge file: ${latestFile}`);
    
    await insertChallengeData(path.join(currentDir, latestFile));
    
  } catch (error) {
    console.error("Error finding latest challenge file:", error);
    throw error;
  }
}

/**
 * Query challenges with their required cards (example usage)
 */
async function queryChallengesWithCards(limit = 5) {
  console.log(`\n🔍 Sample query - Latest ${limit} challenges with their required cards:`);
  console.log("================================================================");
  
  try {
    const { data: challenges, error } = await supabase
      .from('challenges_with_cards')
      .select('*')
      .order('scraped_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error("Error querying challenges:", error);
      return;
    }
    
    challenges.forEach((challenge, index) => {
      console.log(`\n${index + 1}. ${challenge.title}`);
      console.log(`   Description: ${challenge.description?.substring(0, 100)}...`);
      console.log(`   URL: ${challenge.url}`);
      console.log(`   Countdown: ${challenge.countdown_formatted || 'N/A'}`);
      console.log(`   Required Cards: ${challenge.required_cards?.length || 0}`);
      
      if (challenge.required_cards && challenge.required_cards.length > 0) {
        challenge.required_cards.slice(0, 3).forEach((card, cardIndex) => {
          console.log(`     ${cardIndex + 1}. ${card.title} (${card.rarity})`);
        });
        if (challenge.required_cards.length > 3) {
          console.log(`     ... and ${challenge.required_cards.length - 3} more cards`);
        }
      }
    });
    
  } catch (error) {
    console.error("Error in sample query:", error);
  }
}

// Main execution
async function main() {
  console.log("🚀 NBA Top Shot Challenge Data Insertion");
  console.log("========================================\n");
  
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Use specified file
    const filePath = args[0];
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }
    await insertChallengeData(filePath);
  } else {
    // Use latest file
    await insertLatestChallengeFile();
  }
  
  // Show example query
  await queryChallengesWithCards(3);
  
  console.log("\n✨ Done! You can now query your challenge data using:");
  console.log("   - challenges table: Main challenge info");
  console.log("   - required_cards table: Card requirements");
  console.log("   - challenges_with_cards view: Combined data");
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { insertChallengeData, showDataSummary, queryChallengesWithCards }; 