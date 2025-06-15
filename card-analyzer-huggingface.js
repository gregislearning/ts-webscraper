import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Hugging Face API setup (free tier)
const HF_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN; // Optional - works without token but with rate limits
const HF_MODEL = "microsoft/DialoGPT-medium"; // Free text generation model
// Alternative models: "facebook/blenderbot-400M-distill", "microsoft/DialoGPT-large"

/**
 * Call Hugging Face Inference API
 */
async function callHuggingFace(prompt, maxRetries = 3) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  if (HF_API_TOKEN) {
    headers['Authorization'] = `Bearer ${HF_API_TOKEN}`;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(
        `https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1`,
        {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              max_new_tokens: 512,
              temperature: 0.1,
              return_full_text: false
            }
          })
        }
      );

      if (!response.ok) {
        if (response.status === 503 && attempt < maxRetries) {
          console.log(`Model loading, attempt ${attempt}/${maxRetries}, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      return result[0]?.generated_text || result.generated_text || '';
    } catch (error) {
      console.warn(`Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
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
 * Fetch user's card library from Supabase documents table
 */
async function getCardLibrary() {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('id');

    if (error) throw error;
    
    // Parse the content string into structured data
    const parsedCards = (data || []).map(card => {
      try {
        const content = card.content;
        const parts = content.split(' - ');
        
        if (parts.length >= 3) {
          const playerName = parts[0].trim();
          const playType = parts[1].trim();
          const remaining = parts[2].trim();
          
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
            original_content: content
          };
        }
        
        return {
          id: card.id,
          player_name: 'Unknown',
          original_content: content
        };
      } catch (parseError) {
        return {
          id: card.id,
          player_name: 'Parse Error',
          original_content: card.content
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
 * Analyze challenge requirements using Hugging Face
 */
async function analyzeChallengeWithHF(challengeId) {
  console.log(`🔍 Analyzing challenge with Hugging Face...`);
  
  try {
    const challenge = await getChallengeData(challengeId);
    const library = await getCardLibrary();
    
    console.log(`📋 Challenge: ${challenge.title}`);
    console.log(`🃏 Required cards: ${challenge.required_cards?.length || 0}`);
    console.log(`📚 Library size: ${library.length} cards`);

    // Create a more concise prompt for the free model
    const prompt = `Analyze NBA Top Shot card collection for challenge completion.

Challenge: ${challenge.title}
Required cards: ${JSON.stringify(challenge.required_cards?.slice(0, 5) || [], null, 2)}

Available cards (sample): ${JSON.stringify(library.slice(0, 10).map(c => ({
  player: c.player_name,
  series: c.series,
  rarity: c.rarity
})), null, 2)}

Task: Determine which required cards are available in the collection. Consider:
- Exact player name matches
- Rarity upgrades (Rare can fulfill Common requirements)
- Series compatibility

Respond with: AVAILABLE: [list] MISSING: [list] COMPLETION: [percentage]`;

    console.log("🤖 Sending to Hugging Face...");
    
    try {
      const response = await callHuggingFace(prompt);
      
      // Parse the response
      const analysis = parseHFResponse(response, challenge, library);
      
      return analysis;
      
    } catch (hfError) {
      console.warn("Hugging Face API failed, falling back to rule-based analysis:", hfError.message);
      return fallbackAnalysis(challenge, library);
    }

  } catch (error) {
    console.error("Error in challenge analysis:", error);
    throw error;
  }
}

/**
 * Parse Hugging Face response
 */
function parseHFResponse(response, challenge, library) {
  try {
    // Extract structured information from the response
    const availableMatch = response.match(/AVAILABLE:\s*\[(.*?)\]/i);
    const missingMatch = response.match(/MISSING:\s*\[(.*?)\]/i);
    const completionMatch = response.match(/COMPLETION:\s*(\d+)/i);
    
    const available = availableMatch ? availableMatch[1].split(',').map(s => s.trim()) : [];
    const missing = missingMatch ? missingMatch[1].split(',').map(s => s.trim()) : [];
    const completion = completionMatch ? parseInt(completionMatch[1]) : 0;
    
    return {
      can_complete: completion >= 100,
      completion_percentage: completion,
      analysis: {
        matching_cards: available.map(card => ({
          required: card,
          status: 'available',
          source: 'huggingface'
        })),
        missing_cards: missing.map(card => ({
          required: card,
          reason: 'not_in_library',
          source: 'huggingface'
        }))
      },
      summary: `Hugging Face Analysis: ${available.length} available, ${missing.length} missing`,
      recommendations: [
        "Review the analysis above",
        "Consider acquiring missing cards",
        "Check for alternative series that might work"
      ],
      metadata: {
        challenge_id: challenge.id,
        challenge_title: challenge.title,
        analyzed_at: new Date().toISOString(),
        analysis_method: 'huggingface',
        library_size: library.length
      },
      raw_response: response
    };
    
  } catch (parseError) {
    console.warn("Failed to parse HF response, using fallback:", parseError.message);
    return fallbackAnalysis(challenge, library);
  }
}

/**
 * Fallback rule-based analysis when AI fails
 */
function fallbackAnalysis(challenge, library) {
  console.log("🔧 Using rule-based fallback analysis...");
  
  const requiredCards = challenge.required_cards || [];
  const matching = [];
  const missing = [];
  
  // Simple matching logic
  requiredCards.forEach(required => {
    const requiredTitle = required.title.toLowerCase();
    
    // Look for player name matches
    const found = library.find(card => {
      const playerName = card.player_name.toLowerCase();
      return requiredTitle.includes(playerName) || playerName.includes(requiredTitle.split(' ')[0]);
    });
    
    if (found) {
      matching.push({
        required: required,
        library_match: found,
        match_status: 'rule_based_match',
        notes: `Matched ${found.player_name} from ${found.series}`
      });
    } else {
      missing.push({
        required: required,
        reason: 'No matching player found in library',
        alternatives: ['Check marketplace', 'Look for pack drops']
      });
    }
  });
  
  const completionPercentage = Math.round((matching.length / requiredCards.length) * 100);
  
  return {
    can_complete: matching.length === requiredCards.length,
    completion_percentage: completionPercentage,
    analysis: {
      matching_cards: matching,
      missing_cards: missing
    },
    summary: `Rule-based Analysis: Found ${matching.length}/${requiredCards.length} required cards (${completionPercentage}%)`,
    recommendations: [
      matching.length > 0 ? "You have some matching cards!" : "No direct matches found",
      missing.length > 0 ? `Need to acquire ${missing.length} more cards` : "Collection complete for this challenge!",
      "Consider checking for alternative series or rarity upgrades"
    ],
    metadata: {
      challenge_id: challenge.id,
      challenge_title: challenge.title,
      analyzed_at: new Date().toISOString(),
      analysis_method: 'rule_based_fallback',
      library_size: library.length
    }
  };
}

/**
 * Display analysis results
 */
function displayAnalysis(analysis) {
  console.log("\n" + "=".repeat(60));
  console.log(`📋 CHALLENGE ANALYSIS: ${analysis.metadata?.challenge_title || 'Unknown'}`);
  console.log(`🔧 Method: ${analysis.metadata?.analysis_method || 'unknown'}`);
  console.log("=".repeat(60));
  
  console.log(`🎯 Can Complete: ${analysis.can_complete ? '✅ YES' : '❌ NO'}`);
  console.log(`📊 Completion: ${analysis.completion_percentage}%`);
  
  console.log(`\n📝 Summary:`);
  console.log(analysis.summary);
  
  if (analysis.analysis?.matching_cards?.length > 0) {
    console.log(`\n✅ Available Cards:`);
    analysis.analysis.matching_cards.forEach((match, index) => {
      console.log(`   ${index + 1}. ${match.required?.title || match.required}`);
      if (match.library_match) {
        console.log(`      └── Found: ${match.library_match.player_name} (${match.library_match.rarity})`);
      }
    });
  }
  
  if (analysis.analysis?.missing_cards?.length > 0) {
    console.log(`\n❌ Missing Cards:`);
    analysis.analysis.missing_cards.forEach((missing, index) => {
      console.log(`   ${index + 1}. ${missing.required?.title || missing.required}`);
      console.log(`      └── ${missing.reason}`);
    });
  }
  
  if (analysis.recommendations?.length > 0) {
    console.log(`\n💡 Recommendations:`);
    analysis.recommendations.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec}`);
    });
  }
  
  if (analysis.raw_response) {
    console.log(`\n🤖 AI Response:`);
    console.log(analysis.raw_response.substring(0, 300) + "...");
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("🚀 NBA Top Shot Card Analyzer - Hugging Face Edition");
  console.log("====================================================\n");
  
  const args = process.argv.slice(2);
  
  try {
    if (args.length > 0) {
      const challengeId = args[0];
      console.log(`Analyzing specific challenge: ${challengeId}\n`);
      
      const analysis = await analyzeChallengeWithHF(challengeId);
      displayAnalysis(analysis);
      
    } else {
      console.log("Analyzing first available challenge...\n");
      
      const challenges = await getChallengeData();
      if (challenges.length > 0) {
        const analysis = await analyzeChallengeWithHF(challenges[0].id);
        displayAnalysis(analysis);
      } else {
        console.log("No challenges found!");
      }
    }
    
  } catch (error) {
    console.error("❌ Error in main execution:", error);
    process.exit(1);
  }
}

// Export functions
export {
  getChallengeData,
  getCardLibrary,
  analyzeChallengeWithHF,
  displayAnalysis
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 