import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment variable is required");
}

/**
 * Fetch challenge data with required cards from Supabase
 */
async function getChallengeData(challengeId = null) {
  try {
    let query = supabase
      .from('challenges_with_cards')
      .select('*')
      .order('scraped_at', { ascending: false });

    if (challengeId) {
      query = query.eq('id', challengeId);
      const { data, error } = await query.single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await query.limit(10);
      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error("Error fetching challenge data:", error);
    throw error;
  }
}

/**
 * Fetch user's card library from Supabase
 */
async function getCardLibrary(userId = null) {
  try {
    let query = supabase
      .from('documents')
      .select('*')
      .order('id');

    // If we had user-specific libraries, we'd filter by user_id here
    // For now, get all cards in the library
    
    const { data, error } = await query;
    if (error) throw error;
    
    // Parse the content string into structured data
    const parsedCards = (data || []).map(card => {
      try {
        // Parse content format: "PlayerName - PlayType - Date, SeriesName, Team"
        const content = card.content;
        const parts = content.split(' - ');
        
        if (parts.length >= 3) {
          const playerName = parts[0].trim();
          const playType = parts[1].trim();
          const remaining = parts[2].trim();
          
          // Split the remaining part by comma to get date, series, team
          const remainingParts = remaining.split(', ');
          const date = remainingParts[0] || '';
          const series = remainingParts[1] || '';
          const team = remainingParts[2] || '';
          
          return {
            id: card.id,
            player_name: playerName,
            play_type: playType,
            moment_date: date,
            series: series,
            team: team,
            rarity: series.includes('Metallic Gold') ? 'Rare' : 
                   series.includes('LE') ? 'Rare' : 'Common',
            original_content: content,
            created_at: card.created_at
          };
        }
        
        return {
          id: card.id,
          player_name: 'Unknown',
          original_content: content,
          created_at: card.created_at
        };
      } catch (parseError) {
        console.warn(`Error parsing card content: ${card.content}`, parseError);
        return {
          id: card.id,
          player_name: 'Parse Error',
          original_content: card.content,
          created_at: card.created_at
        };
      }
    });
    
    return parsedCards;
  } catch (error) {
    console.error("Error fetching card library:", error);
    throw error;
  }
}

/**
 * Get library summary for easier analysis
 */
async function getLibrarySummary() {
  try {
    // Since we're using the documents table, create summary from the parsed data
    const library = await getCardLibrary();
    
    // Group by player and rarity
    const summary = {};
    library.forEach(card => {
      const key = `${card.player_name}-${card.rarity || 'Unknown'}-${card.series || 'Unknown'}`;
      if (!summary[key]) {
        summary[key] = {
          player_name: card.player_name,
          rarity: card.rarity || 'Unknown',
          series: card.series || 'Unknown',
          count: 0,
          play_types: []
        };
      }
      summary[key].count++;
      if (card.play_type && !summary[key].play_types.includes(card.play_type)) {
        summary[key].play_types.push(card.play_type);
      }
    });
    
    return Object.values(summary).sort((a, b) => a.player_name.localeCompare(b.player_name));
  } catch (error) {
    console.error("Error creating library summary:", error);
    return await getCardLibrary();
  }
}

/**
 * Analyze challenge requirements against user's library using OpenAI
 */
async function analyzeChallengeRequirements(challengeId) {
  console.log(`🔍 Analyzing challenge requirements...`);
  
  try {
    // 1. Fetch challenge data
    const challenge = await getChallengeData(challengeId);
    console.log(`📋 Challenge: ${challenge.title}`);
    console.log(`🃏 Required cards: ${challenge.required_cards?.length || 0}`);

    // 2. Fetch user's card library
    const library = await getCardLibrary();
    console.log(`📚 Library size: ${library.length} cards`);

    // 3. Create detailed prompt for OpenAI
    const prompt = `
You are an NBA Top Shot card collection analyst. Analyze whether a user can complete a challenge based on their card library.

CHALLENGE DETAILS:
Title: ${challenge.title}
Description: ${challenge.description}
Countdown: ${challenge.countdown_formatted || 'N/A'}

REQUIRED CARDS:
${JSON.stringify(challenge.required_cards, null, 2)}

USER'S CARD LIBRARY:
${JSON.stringify(library, null, 2)}

ANALYSIS RULES:
1. Match cards by player name primarily
2. Consider rarity hierarchies: Legendary > Rare > Common
3. Cards with "or higher tier" can be fulfilled by higher rarities
4. Look for exact series/set matches when specified
5. Consider alternative players when mentioned (e.g., "Thunder or Pacers Big 3")
6. Be specific about which exact cards are missing vs available

Please provide a detailed JSON analysis with:
{
  "can_complete": boolean,
  "completion_percentage": number (0-100),
  "analysis": {
    "matching_cards": [
      {
        "required": "card requirement object",
        "library_match": "matching library card object or null",
        "match_status": "exact_match|rarity_upgrade|no_match",
        "notes": "explanation of match logic"
      }
    ],
    "missing_cards": [
      {
        "required": "card requirement object", 
        "reason": "why it's missing",
        "alternatives": ["suggested alternatives or how to acquire"]
      }
    ]
  },
  "summary": "Human-readable summary of findings",
  "recommendations": ["actionable suggestions for completing the challenge"]
}

Focus on being accurate and helpful. If there are multiple ways to fulfill a requirement, mention them.
`;

    // 4. Send to OpenAI for analysis
    console.log("🤖 Sending to OpenAI for analysis...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an expert NBA Top Shot card analyst. Always respond with valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1 // Low temperature for consistent analysis
    });

    const analysis = JSON.parse(response.choices[0].message.content);
    
    // 5. Add metadata
    analysis.metadata = {
      challenge_id: challenge.id,
      challenge_title: challenge.title,
      analyzed_at: new Date().toISOString(),
      library_size: library.length,
      required_cards_count: challenge.required_cards?.length || 0
    };

    return analysis;

  } catch (error) {
    console.error("Error in challenge analysis:", error);
    throw error;
  }
}

/**
 * Analyze all available challenges
 */
async function analyzeAllChallenges() {
  console.log("🔍 Analyzing all available challenges...");
  
  try {
    const challenges = await getChallengeData(); // Get all challenges
    const results = [];

    for (const challenge of challenges) {
      console.log(`\nAnalyzing: ${challenge.title}`);
      try {
        const analysis = await analyzeChallengeRequirements(challenge.id);
        results.push(analysis);
        
        // Brief summary for each
        console.log(`✅ ${analysis.can_complete ? 'CAN COMPLETE' : 'CANNOT COMPLETE'} (${analysis.completion_percentage}%)`);
        
      } catch (error) {
        console.error(`Error analyzing ${challenge.title}:`, error.message);
        results.push({
          error: error.message,
          challenge_id: challenge.id,
          challenge_title: challenge.title
        });
      }
    }

    return results;
  } catch (error) {
    console.error("Error analyzing all challenges:", error);
    throw error;
  }
}

/**
 * Display analysis results in a readable format
 */
function displayAnalysis(analysis) {
  console.log("\n" + "=".repeat(60));
  console.log(`📋 CHALLENGE ANALYSIS: ${analysis.metadata?.challenge_title || 'Unknown'}`);
  console.log("=".repeat(60));
  
  console.log(`🎯 Can Complete: ${analysis.can_complete ? '✅ YES' : '❌ NO'}`);
  console.log(`📊 Completion: ${analysis.completion_percentage}%`);
  
  console.log(`\n📝 Summary:`);
  console.log(analysis.summary);
  
  if (analysis.analysis?.matching_cards?.length > 0) {
    console.log(`\n✅ Matching Cards:`);
    analysis.analysis.matching_cards.forEach((match, index) => {
      const status = match.match_status === 'exact_match' ? '✅' : 
                    match.match_status === 'rarity_upgrade' ? '⬆️' : '❌';
      console.log(`   ${index + 1}. ${status} ${match.required.title}`);
      if (match.library_match) {
        console.log(`      └── Fulfilled by: ${match.library_match.player_name} (${match.library_match.rarity})`);
      }
      if (match.notes) {
        console.log(`      └── ${match.notes}`);
      }
    });
  }
  
  if (analysis.analysis?.missing_cards?.length > 0) {
    console.log(`\n❌ Missing Cards:`);
    analysis.analysis.missing_cards.forEach((missing, index) => {
      console.log(`   ${index + 1}. ${missing.required.title} (${missing.required.rarity})`);
      console.log(`      └── ${missing.reason}`);
      if (missing.alternatives?.length > 0) {
        console.log(`      └── Alternatives: ${missing.alternatives.join(', ')}`);
      }
    });
  }
  
  if (analysis.recommendations?.length > 0) {
    console.log(`\n💡 Recommendations:`);
    analysis.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log("🚀 NBA Top Shot Card Library Analyzer");
  console.log("=====================================\n");
  
  const args = process.argv.slice(2);
  
  try {
    if (args.length > 0) {
      // Analyze specific challenge
      const challengeId = args[0];
      console.log(`Analyzing specific challenge: ${challengeId}`);
      
      const analysis = await analyzeChallengeRequirements(challengeId);
      displayAnalysis(analysis);
      
    } else {
      // Analyze all challenges
      console.log("Analyzing all available challenges...\n");
      
      const results = await analyzeAllChallenges();
      
      // Display summary
      console.log("\n" + "=".repeat(60));
      console.log("📊 OVERALL SUMMARY");
      console.log("=".repeat(60));
      
      const completable = results.filter(r => r.can_complete).length;
      const total = results.filter(r => !r.error).length;
      
      console.log(`✅ Completable challenges: ${completable}/${total}`);
      console.log(`📊 Average completion rate: ${Math.round(results.reduce((sum, r) => sum + (r.completion_percentage || 0), 0) / total)}%`);
      
      // Show top completable challenges
      const sortedCompletable = results
        .filter(r => r.can_complete && !r.error)
        .sort((a, b) => b.completion_percentage - a.completion_percentage);
      
      if (sortedCompletable.length > 0) {
        console.log(`\n🎯 Top Completable Challenges:`);
        sortedCompletable.slice(0, 3).forEach((result, index) => {
          console.log(`   ${index + 1}. ${result.metadata.challenge_title} (${result.completion_percentage}%)`);
        });
      }
      
      // Show detailed analysis for the first challenge
      if (results.length > 0 && !results[0].error) {
        console.log(`\n📋 Detailed Analysis for First Challenge:`);
        displayAnalysis(results[0]);
      }
    }
    
  } catch (error) {
    console.error("❌ Error in main execution:", error);
    process.exit(1);
  }
}

// Export functions for use in other modules
export {
  getChallengeData,
  getCardLibrary,
  getLibrarySummary,
  analyzeChallengeRequirements,
  analyzeAllChallenges,
  displayAnalysis
};

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 