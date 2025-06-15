import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Ollama configuration
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama2'; // or 'mistral', 'codellama', etc.

/**
 * Call Ollama API (local)
 */
async function callOllama(prompt, model = OLLAMA_MODEL) {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 512
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result.response || '';
    
  } catch (error) {
    console.error("Ollama API error:", error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log("\n🔧 Ollama Setup Instructions:");
      console.log("1. Install Ollama: https://ollama.ai/");
      console.log("2. Run: ollama pull llama2");
      console.log("3. Start Ollama: ollama serve");
      console.log("4. Then run this script again\n");
    }
    
    throw error;
  }
}

/**
 * Check if Ollama is available
 */
async function checkOllamaAvailability() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      console.log(`✅ Ollama is running with ${data.models?.length || 0} models available`);
      return true;
    }
    return false;
  } catch (error) {
    console.log("❌ Ollama is not running");
    return false;
  }
}

/**
 * Fetch challenge data
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
      const { data, error } = await query.limit(5);
      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error("Error fetching challenge data:", error);
    throw error;
  }
}

/**
 * Fetch card library
 */
async function getCardLibrary() {
  try {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('id');

    if (error) throw error;
    
    const parsedCards = (data || []).map(card => {
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
    });
    
    return parsedCards;
  } catch (error) {
    console.error("Error fetching card library:", error);
    throw error;
  }
}

/**
 * Analyze challenge using Ollama
 */
async function analyzeChallengeWithOllama(challengeId) {
  console.log(`🔍 Analyzing challenge with Ollama (${OLLAMA_MODEL})...`);
  
  try {
    // Check if Ollama is available
    const ollamaAvailable = await checkOllamaAvailability();
    if (!ollamaAvailable) {
      console.log("⚠️ Ollama not available, using rule-based fallback");
      const challenge = await getChallengeData(challengeId);
      const library = await getCardLibrary();
      return fallbackAnalysis(challenge, library);
    }

    const challenge = await getChallengeData(challengeId);
    const library = await getCardLibrary();
    
    console.log(`📋 Challenge: ${challenge.title}`);
    console.log(`🃏 Required cards: ${challenge.required_cards?.length || 0}`);
    console.log(`📚 Library size: ${library.length} cards`);

    // Create focused prompt for local model
    const libraryPlayers = [...new Set(library.map(c => c.player_name))].slice(0, 20);
    const requiredCards = challenge.required_cards?.slice(0, 5) || [];
    
    const prompt = `You are analyzing an NBA Top Shot card collection for challenge completion.

CHALLENGE: ${challenge.title}

REQUIRED CARDS:
${requiredCards.map((card, i) => `${i+1}. ${card.title} (${card.rarity})`).join('\n')}

AVAILABLE PLAYERS IN COLLECTION:
${libraryPlayers.join(', ')}

TASK: For each required card, determine if the player is available in the collection. Consider:
- Exact name matches
- Common name variations (e.g., "De'Aaron" vs "DeAaron")  
- Higher rarities can fulfill lower rarity requirements

FORMAT YOUR RESPONSE AS:
MATCHES: [list player names found]
MISSING: [list player names not found]
COMPLETION: [percentage]`;

    console.log("🤖 Sending to Ollama...");
    
    try {
      const response = await callOllama(prompt);
      return parseOllamaResponse(response, challenge, library);
      
    } catch (ollamaError) {
      console.warn("Ollama failed, using fallback:", ollamaError.message);
      return fallbackAnalysis(challenge, library);
    }

  } catch (error) {
    console.error("Error in Ollama analysis:", error);
    throw error;
  }
}

/**
 * Parse Ollama response
 */
function parseOllamaResponse(response, challenge, library) {
  try {
    console.log("\n🤖 Ollama Response:");
    console.log(response);
    
    // Extract matches and missing from response
    const matchesMatch = response.match(/MATCHES:\s*(.*?)(?:\n|MISSING|$)/is);
    const missingMatch = response.match(/MISSING:\s*(.*?)(?:\n|COMPLETION|$)/is);
    const completionMatch = response.match(/COMPLETION:\s*(\d+)/i);
    
    const matches = matchesMatch ? 
      matchesMatch[1].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0) : [];
    const missing = missingMatch ? 
      missingMatch[1].split(/[,\n]/).map(s => s.trim()).filter(s => s.length > 0) : [];
    const completion = completionMatch ? parseInt(completionMatch[1]) : 0;
    
    // Map matches to actual library cards
    const matchingCards = matches.map(match => {
      const libraryCard = library.find(card => 
        card.player_name.toLowerCase().includes(match.toLowerCase()) ||
        match.toLowerCase().includes(card.player_name.toLowerCase())
      );
      
      return {
        required: match,
        library_match: libraryCard,
        match_status: libraryCard ? 'found' : 'claimed_but_not_verified',
        notes: libraryCard ? `Found ${libraryCard.player_name} in ${libraryCard.series}` : 'AI claimed match but not verified'
      };
    });
    
    const missingCards = missing.map(miss => ({
      required: miss,
      reason: 'Not found in collection according to AI',
      alternatives: ['Check marketplace', 'Look for pack drops']
    }));
    
    return {
      can_complete: completion >= 100,
      completion_percentage: completion,
      analysis: {
        matching_cards: matchingCards,
        missing_cards: missingCards
      },
      summary: `Ollama Analysis (${OLLAMA_MODEL}): ${matches.length} matches found, ${missing.length} missing`,
      recommendations: [
        matches.length > 0 ? `AI found ${matches.length} potential matches` : "No matches identified by AI",
        missing.length > 0 ? `AI identified ${missing.length} missing cards` : "AI thinks you have all required cards",
        "Verify AI analysis manually for accuracy"
      ],
      metadata: {
        challenge_id: challenge.id,
        challenge_title: challenge.title,
        analyzed_at: new Date().toISOString(),
        analysis_method: `ollama_${OLLAMA_MODEL}`,
        library_size: library.length
      },
      raw_response: response
    };
    
  } catch (parseError) {
    console.warn("Failed to parse Ollama response:", parseError.message);
    return fallbackAnalysis(challenge, library);
  }
}

/**
 * Rule-based fallback analysis
 */
function fallbackAnalysis(challenge, library) {
  console.log("🔧 Using rule-based analysis...");
  
  const requiredCards = challenge.required_cards || [];
  const matching = [];
  const missing = [];
  
  requiredCards.forEach(required => {
    const requiredTitle = required.title.toLowerCase();
    
    // Extract potential player names from requirement
    const potentialNames = extractPlayerNames(requiredTitle);
    
    let found = null;
    for (const name of potentialNames) {
      found = library.find(card => {
        const playerName = card.player_name.toLowerCase();
        return playerName.includes(name.toLowerCase()) || 
               name.toLowerCase().includes(playerName.replace(/'/g, ''));
      });
      if (found) break;
    }
    
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
        alternatives: ['Check for name variations', 'Look in marketplace']
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
    summary: `Rule-based Analysis: ${matching.length}/${requiredCards.length} cards found (${completionPercentage}%)`,
    recommendations: [
      matching.length > 0 ? `Found ${matching.length} matching cards` : "No direct matches found",
      missing.length > 0 ? `Need ${missing.length} more cards` : "All required cards available!",
      "This is a basic analysis - manual verification recommended"
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
 * Extract player names from requirement text
 */
function extractPlayerNames(text) {
  const commonPlayers = [
    'Jalen Williams', 'Chet Holmgren', 'Shai Gilgeous-Alexander', 'Kenrich Williams',
    'Tyrese Haliburton', 'Pascal Siakam', 'Aaron Nesmith', 'Obi Toppin',
    'Karl-Anthony Towns', 'Jalen Brunson', 'Anthony Edwards', 'Nickeil Alexander-Walker',
    'Isaiah Hartenstein', 'Miles McBride', 'OG Anunoby', 'Mitchell Robinson',
    'De\'Aaron Fox', 'Saddiq Bey', 'Buddy Hield', 'Daniel Gafford', 'Jaden Ivey'
  ];
  
  const found = [];
  commonPlayers.forEach(player => {
    if (text.toLowerCase().includes(player.toLowerCase())) {
      found.push(player);
    }
  });
  
  // Also look for "SGA" -> "Shai Gilgeous-Alexander"
  if (text.toLowerCase().includes('sga')) {
    found.push('Shai Gilgeous-Alexander');
  }
  
  return found.length > 0 ? found : [text.split(' ')[0]]; // fallback to first word
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
    console.log(`\n✅ Available/Matching Cards:`);
    analysis.analysis.matching_cards.forEach((match, index) => {
      console.log(`   ${index + 1}. ${match.required?.title || match.required}`);
      if (match.library_match) {
        console.log(`      └── Found: ${match.library_match.player_name} (${match.library_match.rarity})`);
      }
      if (match.notes) {
        console.log(`      └── ${match.notes}`);
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
}

/**
 * Main execution
 */
async function main() {
  console.log("🚀 NBA Top Shot Card Analyzer - Ollama Local Edition");
  console.log("===================================================\n");
  
  const args = process.argv.slice(2);
  
  try {
    if (args.length > 0) {
      const challengeId = args[0];
      console.log(`Analyzing specific challenge: ${challengeId}\n`);
      
      const analysis = await analyzeChallengeWithOllama(challengeId);
      displayAnalysis(analysis);
      
    } else {
      console.log("Analyzing first available challenge...\n");
      
      const challenges = await getChallengeData();
      if (challenges.length > 0) {
        const analysis = await analyzeChallengeWithOllama(challenges[0].id);
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
  analyzeChallengeWithOllama,
  displayAnalysis,
  checkOllamaAvailability
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 