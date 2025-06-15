import { createClient } from "@supabase/supabase-js";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
 * Simple rule-based analysis
 */
async function analyzeChallenge(challengeId) {
  console.log(`🔍 Analyzing challenge with rule-based matching...`);
  
  try {
    const challenge = await getChallengeData(challengeId);
    const library = await getCardLibrary();
    
    console.log(`📋 Challenge: ${challenge.title}`);
    console.log(`🃏 Required cards: ${challenge.required_cards?.length || 0}`);
    console.log(`📚 Library size: ${library.length} cards`);

    const requiredCards = challenge.required_cards || [];
    const matching = [];
    const missing = [];
    const partial = [];

    // Create player lookup for faster searching
    const playerLookup = {};
    library.forEach(card => {
      const cleanName = card.player_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!playerLookup[cleanName]) {
        playerLookup[cleanName] = [];
      }
      playerLookup[cleanName].push(card);
    });

    // Analyze each required card
    requiredCards.forEach((required, index) => {
      console.log(`\n🔍 Analyzing requirement ${index + 1}: ${required.title}`);
      
      const result = findMatchingCard(required, library, playerLookup);
      
      if (result.exact_match) {
        matching.push({
          required: required,
          library_match: result.exact_match,
          match_status: 'exact_match',
          notes: `Exact match: ${result.exact_match.player_name}`
        });
        console.log(`   ✅ EXACT MATCH: ${result.exact_match.player_name} (${result.exact_match.series})`);
        
      } else if (result.rarity_upgrade) {
        matching.push({
          required: required,
          library_match: result.rarity_upgrade,
          match_status: 'rarity_upgrade',
          notes: `Higher rarity available: ${result.rarity_upgrade.player_name} (${result.rarity_upgrade.rarity})`
        });
        console.log(`   ⬆️ RARITY UPGRADE: ${result.rarity_upgrade.player_name} (${result.rarity_upgrade.rarity})`);
        
      } else if (result.partial_matches.length > 0) {
        partial.push({
          required: required,
          potential_matches: result.partial_matches,
          match_status: 'potential_match',
          notes: `Potential matches found but need verification`
        });
        console.log(`   🤔 POTENTIAL: ${result.partial_matches.map(m => m.player_name).join(', ')}`);
        
      } else {
        missing.push({
          required: required,
          reason: 'No matching player found in library',
          alternatives: ['Check marketplace', 'Look for pack drops', 'Verify player name spelling']
        });
        console.log(`   ❌ MISSING: No matches found`);
      }
    });

    const exactMatches = matching.filter(m => m.match_status === 'exact_match').length;
    const upgradeMatches = matching.filter(m => m.match_status === 'rarity_upgrade').length;
    const totalMatches = matching.length;
    const completionPercentage = Math.round((totalMatches / requiredCards.length) * 100);
    
    return {
      can_complete: totalMatches === requiredCards.length,
      completion_percentage: completionPercentage,
      analysis: {
        matching_cards: matching,
        missing_cards: missing,
        partial_matches: partial,
        stats: {
          exact_matches: exactMatches,
          rarity_upgrades: upgradeMatches,
          potential_matches: partial.length,
          missing: missing.length
        }
      },
      summary: `Found ${totalMatches}/${requiredCards.length} required cards (${exactMatches} exact, ${upgradeMatches} upgrades)`,
      recommendations: generateRecommendations(matching, missing, partial),
      metadata: {
        challenge_id: challenge.id,
        challenge_title: challenge.title,
        analyzed_at: new Date().toISOString(),
        analysis_method: 'rule_based',
        library_size: library.length
      }
    };

  } catch (error) {
    console.error("Error in challenge analysis:", error);
    throw error;
  }
}

/**
 * Find matching card in library
 */
function findMatchingCard(required, library, playerLookup) {
  const result = {
    exact_match: null,
    rarity_upgrade: null,
    partial_matches: []
  };

  // Extract player names from the requirement
  const playerNames = extractPlayerNames(required.title);
  
  for (const playerName of playerNames) {
    const cleanName = playerName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    // Look for exact matches first
    if (playerLookup[cleanName]) {
      const matches = playerLookup[cleanName];
      
      // Check for exact series/rarity match
      const exactMatch = matches.find(card => 
        matchesRequirement(card, required)
      );
      
      if (exactMatch) {
        result.exact_match = exactMatch;
        return result; // Return immediately on exact match
      }
      
      // Check for rarity upgrades
      const upgradeMatch = matches.find(card => 
        isRarityUpgrade(card, required)
      );
      
      if (upgradeMatch) {
        result.rarity_upgrade = upgradeMatch;
      }
      
      // Add all matches as potential
      result.partial_matches.push(...matches);
    }
    
    // Fuzzy matching for name variations
    const fuzzyMatches = library.filter(card => {
      const cardName = card.player_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return cardName.includes(cleanName) || cleanName.includes(cardName) ||
             calculateSimilarity(cardName, cleanName) > 0.8;
    });
    
    result.partial_matches.push(...fuzzyMatches);
  }
  
  // Remove duplicates
  result.partial_matches = [...new Map(result.partial_matches.map(card => [card.id, card])).values()];
  
  return result;
}

/**
 * Check if card matches requirement exactly
 */
function matchesRequirement(card, required) {
  // Check if series matches (if specified)
  if (required.rarity.includes('2025 NBA Playoffs')) {
    if (!card.series.includes('2025') && !card.series.includes('Playoffs')) {
      return false;
    }
  }
  
  // Check if rarity matches
  const requiredRarity = extractRarity(required.rarity);
  const cardRarity = card.rarity;
  
  if (requiredRarity && cardRarity) {
    return rarityMatches(cardRarity, requiredRarity);
  }
  
  return true; // Default to match if we can't determine rarity
}

/**
 * Check if card provides rarity upgrade
 */
function isRarityUpgrade(card, required) {
  const requiredRarity = extractRarity(required.rarity);
  const cardRarity = card.rarity;
  
  if (!requiredRarity || !cardRarity) return false;
  
  const rarityOrder = { 'Common': 1, 'Rare': 2, 'Legendary': 3 };
  
  return rarityOrder[cardRarity] > rarityOrder[requiredRarity];
}

/**
 * Check if rarities match (including "or higher tier")
 */
function rarityMatches(cardRarity, requiredRarity) {
  if (requiredRarity.includes('or higher tier')) {
    const baseRarity = requiredRarity.split(' ')[0];
    const rarityOrder = { 'Common': 1, 'Rare': 2, 'Legendary': 3 };
    return rarityOrder[cardRarity] >= rarityOrder[baseRarity];
  }
  
  return cardRarity.toLowerCase().includes(requiredRarity.toLowerCase());
}

/**
 * Extract rarity from requirement text
 */
function extractRarity(text) {
  if (text.includes('Legendary')) return 'Legendary';
  if (text.includes('Rare')) return 'Rare';
  if (text.includes('Common')) return 'Common';
  return null;
}

/**
 * Extract player names from requirement text
 */
function extractPlayerNames(text) {
  // List of known NBA players
  const knownPlayers = [
    'Jalen Williams', 'Chet Holmgren', 'Shai Gilgeous-Alexander', 'Kenrich Williams',
    'Tyrese Haliburton', 'Pascal Siakam', 'Aaron Nesmith', 'Obi Toppin',
    'Karl-Anthony Towns', 'Jalen Brunson', 'Anthony Edwards', 'Nickeil Alexander-Walker',
    'Isaiah Hartenstein', 'Miles McBride', 'OG Anunoby', 'Mitchell Robinson',
    'De\'Aaron Fox', 'Saddiq Bey', 'Buddy Hield', 'Daniel Gafford', 'Jaden Ivey',
    'Ben Sheppard', 'Rudy Gobert', 'Julius Randle', 'Donte DiVincenzo', 'Jaden McDaniels'
  ];
  
  const found = [];
  const textLower = text.toLowerCase();
  
  knownPlayers.forEach(player => {
    if (textLower.includes(player.toLowerCase())) {
      found.push(player);
    }
  });
  
  // Handle special cases
  if (textLower.includes('sga')) {
    found.push('Shai Gilgeous-Alexander');
  }
  
  // If no known players found, try to extract first word as potential name
  if (found.length === 0) {
    const words = text.split(' ');
    if (words.length > 0 && words[0].length > 2) {
      found.push(words[0]);
    }
  }
  
  return [...new Set(found)]; // Remove duplicates
}

/**
 * Calculate string similarity (0-1)
 */
function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance
 */
function levenshteinDistance(str1, str2) {
  const matrix = Array(str2.length + 1).fill().map(() => Array(str1.length + 1).fill(0));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(matching, missing, partial) {
  const recommendations = [];
  
  if (matching.length > 0) {
    const exactCount = matching.filter(m => m.match_status === 'exact_match').length;
    const upgradeCount = matching.filter(m => m.match_status === 'rarity_upgrade').length;
    
    if (exactCount > 0) {
      recommendations.push(`You have ${exactCount} exact matches - great collection!`);
    }
    if (upgradeCount > 0) {
      recommendations.push(`You have ${upgradeCount} higher rarity cards that can fulfill requirements`);
    }
  }
  
  if (missing.length > 0) {
    recommendations.push(`Need to acquire ${missing.length} cards to complete challenge`);
    recommendations.push(`Check NBA Top Shot marketplace for missing cards`);
  }
  
  if (partial.length > 0) {
    recommendations.push(`${partial.length} potential matches found - verify manually`);
  }
  
  if (matching.length === 0 && missing.length > 0) {
    recommendations.push(`Focus on acquiring any card from this challenge first`);
  }
  
  recommendations.push(`Consider checking for alternative series or special editions`);
  
  return recommendations;
}

/**
 * Display detailed analysis results
 */
function displayAnalysis(analysis) {
  console.log("\n" + "=".repeat(70));
  console.log(`📋 CHALLENGE ANALYSIS: ${analysis.metadata?.challenge_title || 'Unknown'}`);
  console.log(`🔧 Method: ${analysis.metadata?.analysis_method || 'unknown'}`);
  console.log("=".repeat(70));
  
  console.log(`🎯 Can Complete: ${analysis.can_complete ? '✅ YES' : '❌ NO'}`);
  console.log(`📊 Completion: ${analysis.completion_percentage}%`);
  
  console.log(`\n📝 Summary:`);
  console.log(analysis.summary);
  
  if (analysis.analysis?.stats) {
    const stats = analysis.analysis.stats;
    console.log(`\n📈 Detailed Breakdown:`);
    console.log(`   ✅ Exact matches: ${stats.exact_matches}`);
    console.log(`   ⬆️ Rarity upgrades: ${stats.rarity_upgrades}`);
    console.log(`   🤔 Potential matches: ${stats.potential_matches}`);
    console.log(`   ❌ Missing: ${stats.missing}`);
  }
  
  if (analysis.analysis?.matching_cards?.length > 0) {
    console.log(`\n✅ Available Cards:`);
    analysis.analysis.matching_cards.forEach((match, index) => {
      const status = match.match_status === 'exact_match' ? '✅' : '⬆️';
      console.log(`   ${index + 1}. ${status} ${match.required.title}`);
      console.log(`      └── ${match.notes}`);
    });
  }
  
  if (analysis.analysis?.partial_matches?.length > 0) {
    console.log(`\n🤔 Potential Matches (Verify Manually):`);
    analysis.analysis.partial_matches.forEach((partial, index) => {
      console.log(`   ${index + 1}. ${partial.required.title}`);
      console.log(`      └── Potential: ${partial.potential_matches.slice(0, 3).map(p => p.player_name).join(', ')}`);
    });
  }
  
  if (analysis.analysis?.missing_cards?.length > 0) {
    console.log(`\n❌ Missing Cards:`);
    analysis.analysis.missing_cards.forEach((missing, index) => {
      console.log(`   ${index + 1}. ${missing.required.title}`);
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
 * Analyze all challenges
 */
async function analyzeAllChallenges() {
  console.log("🔍 Analyzing all challenges...\n");
  
  try {
    const challenges = await getChallengeData();
    const results = [];
    
    for (let i = 0; i < challenges.length; i++) {
      const challenge = challenges[i];
      console.log(`\n${'='.repeat(50)}`);
      console.log(`Analyzing ${i + 1}/${challenges.length}: ${challenge.title}`);
      console.log('='.repeat(50));
      
      try {
        const analysis = await analyzeChallenge(challenge.id);
        results.push(analysis);
        
        console.log(`\n📊 Result: ${analysis.can_complete ? '✅ CAN COMPLETE' : '❌ CANNOT COMPLETE'} (${analysis.completion_percentage}%)`);
        
      } catch (error) {
        console.error(`❌ Error analyzing ${challenge.title}:`, error.message);
        results.push({
          error: error.message,
          challenge_id: challenge.id,
          challenge_title: challenge.title
        });
      }
    }
    
    // Summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 OVERALL SUMMARY");
    console.log("=".repeat(70));
    
    const successful = results.filter(r => !r.error);
    const completable = successful.filter(r => r.can_complete);
    const avgCompletion = successful.length > 0 ? 
      Math.round(successful.reduce((sum, r) => sum + r.completion_percentage, 0) / successful.length) : 0;
    
    console.log(`✅ Completable challenges: ${completable.length}/${successful.length}`);
    console.log(`📊 Average completion rate: ${avgCompletion}%`);
    
    if (completable.length > 0) {
      console.log(`\n🎯 Completable Challenges:`);
      completable.forEach((result, index) => {
        console.log(`   ${index + 1}. ${result.metadata.challenge_title} (${result.completion_percentage}%)`);
      });
    }
    
    return results;
    
  } catch (error) {
    console.error("Error analyzing all challenges:", error);
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log("🚀 NBA Top Shot Card Analyzer - Simple Rule-Based Edition");
  console.log("=========================================================\n");
  
  const args = process.argv.slice(2);
  
  try {
    if (args.includes('--all')) {
      await analyzeAllChallenges();
      
    } else if (args.length > 0) {
      const challengeId = args[0];
      console.log(`Analyzing specific challenge: ${challengeId}\n`);
      
      const analysis = await analyzeChallenge(challengeId);
      displayAnalysis(analysis);
      
    } else {
      console.log("Analyzing first available challenge...\n");
      
      const challenges = await getChallengeData();
      if (challenges.length > 0) {
        const analysis = await analyzeChallenge(challenges[0].id);
        displayAnalysis(analysis);
        
        console.log("\n💡 Tip: Use --all flag to analyze all challenges");
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
  analyzeChallenge,
  analyzeAllChallenges,
  displayAnalysis
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 