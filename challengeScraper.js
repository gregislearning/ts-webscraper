import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Adblocker from "puppeteer-extra-plugin-adblocker";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { performLogin } from "./login.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  url: "https://nbatopshot.com/challenges",
  viewport: {
    width: 1920,
    height: 1080,
  },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  headers: {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
    "upgrade-insecure-requests": "1",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-encoding": "gzip, deflate, br",
    "accept-language": "en-US,en;q=0.9,en;q=0.8",
  },
  selectors: {
    challengeContainer: ".css-kjafn5",
    challengeCard: ".sc-59097960-0.dFlqUg.sc-cbe3541b-0.irrWCZ",
    challengeLink: "a[href*='/challenges/']",
    challengeTitle: "h3.chakra-heading.css-1jbwuil",
    challengeDescription: "p.chakra-text.css-16naafx",
    countdownContainer: ".css-igw4uv",
    countdownDays: ".css-dvxtzn h2.chakra-heading.css-kct8x3",
    earnButton: "a.chakra-button.css-1qr2lr9",
    loadMoreButton: "button.chakra-button.css-3j1q3h",
    // Selectors for individual challenge pages
    requiredCardsSection: "[data-testid='required-cards'], .required-cards, [class*='required'], [class*='cards']",
    cardElement: "[data-testid='card'], .card, [class*='moment']",
  },
  timeouts: {
    pageLoad: 5000,
    challengePageLoad: 3000,
    loadMore: 2000,
    navigation: 60000,
    retry: 2000,
  },
  retries: {
    navigation: 3,
    extraction: 2,
  },
};

const textRegex = /(javascript|html)/; // Regex for monitoring network requests

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Load cookies from file
 */
const loadCookies = () => {
  try {
    return JSON.parse(fs.readFileSync("./cookies.json", "utf8"));
  } catch (error) {
    console.warn("Could not load cookies:", error.message);
    return [];
  }
};

/**
 * Setup browser with plugins and configurations
 */
const setupBrowser = async () => {
  console.log("Setting up browser...");
  
  // Add plugins
  puppeteerExtra.use(Adblocker());
  puppeteerExtra.use(StealthPlugin());
  
  // Launch browser
  const browser = await puppeteerExtra.launch({ headless: false });
  const page = await browser.newPage();
  
  // Configure page
  await page.setUserAgent(CONFIG.userAgent);
  await page.setExtraHTTPHeaders(CONFIG.headers);
  await page.setViewport(CONFIG.viewport);
  
  return { browser, page };
};

/**
 * Setup network monitoring
 */
const setupNetworkMonitoring = (page) => {
  console.log("Setting up network monitoring...");
  
  page.on("response", (response) => {
    const headers = response.headers();
    const contentType = headers["content-type"];
    
    // Monitor specific content types
    if (textRegex.test(contentType)) {
      // Uncomment to log URLs
      // console.log(response.url());
    }
  });
};

/**
 * Cross-version compatible wait function
 */
const waitForTimeout = async (page, timeout) => {
  try {
    // Try the newer method first
    if (page.waitForTimeout) {
      await page.waitForTimeout(timeout);
    } else if (page.waitFor) {
      // Fallback to older method
      await page.waitFor(timeout);
    } else {
      // Last resort: use setTimeout with Promise
      await new Promise(resolve => setTimeout(resolve, timeout));
    }
  } catch (error) {
    console.warn("Wait timeout error:", error.message);
    // Fallback to basic setTimeout
    await new Promise(resolve => setTimeout(resolve, timeout));
  }
};

/**
 * Navigate to the target URL and wait for page load
 */
const navigateToPage = async (page) => {
  console.log(`Navigating to: ${CONFIG.url}`);
  
  try {
    // Navigate with increased timeout and more lenient wait conditions
    await page.goto(CONFIG.url, { 
      waitUntil: 'domcontentloaded', // Less strict than 'load'
      timeout: CONFIG.timeouts.navigation // Increased timeout to 60 seconds
    });
    
    // Wait for the page to be ready
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: CONFIG.timeouts.pageLoad });
    
    console.log("Page navigation completed");
  } catch (error) {
    console.warn("Initial navigation failed, trying alternative approach:", error.message);
    
    // Fallback: Try with networkidle2
    try {
      await page.goto(CONFIG.url, { 
        waitUntil: 'networkidle2',
        timeout: CONFIG.timeouts.navigation 
      });
      console.log("Page navigation completed (fallback method)");
    } catch (fallbackError) {
      console.warn("Fallback navigation also failed, proceeding anyway:", fallbackError.message);
      
              // Last resort: Just navigate without waiting
        await page.goto(CONFIG.url, { timeout: CONFIG.timeouts.navigation });
        await waitForTimeout(page, CONFIG.timeouts.pageLoad); // Give it 5 seconds to load
        console.log("Page navigation completed (minimal wait)");
    }
  }
};

/**
 * Extract countdown information from challenge card
 */
const extractCountdown = async (challengeCard) => {
  try {
    const countdownElements = await challengeCard.$$(CONFIG.selectors.countdownDays);
    if (countdownElements.length >= 4) {
      const days = await countdownElements[0].textContent();
      const hours = await countdownElements[1].textContent();
      const minutes = await countdownElements[2].textContent();
      const seconds = await countdownElements[3].textContent();
      
      return {
        days: parseInt(days) || 0,
        hours: parseInt(hours) || 0,
        minutes: parseInt(minutes) || 0,
        seconds: parseInt(seconds) || 0,
        formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`
      };
    }
  } catch (error) {
    console.warn("Could not extract countdown:", error.message);
  }
  return null;
};

/**
 * Extract challenge information from the main challenges page and scrape individual pages
 */
const extractChallengeInfo = async (page) => {
  console.log("Extracting challenge information...");
  
  const challenges = [];
  const maxChallengesPerPage = 20; // Safety limit
  const maxTimePerChallenge = 60000; // 60 seconds max per challenge
  
  try {
    // Wait for challenge cards to load
    await page.waitForSelector(CONFIG.selectors.challengeContainer, { timeout: CONFIG.timeouts.navigation });
    
    // Get all challenge cards
    const challengeCards = await page.$$(CONFIG.selectors.challengeCard);
    console.log(`Found ${challengeCards.length} challenge cards`);
    
    // Limit the number of challenges to process to prevent infinite loops
    const challengesToProcess = Math.min(challengeCards.length, maxChallengesPerPage);
    console.log(`Processing ${challengesToProcess} challenges (limited for safety)`);
    
    for (let i = 0; i < challengesToProcess; i++) {
      const challengeStartTime = Date.now();
      
      try {
        console.log(`Processing challenge card ${i + 1}/${challengesToProcess}`);
        
        // Add timeout wrapper for the entire challenge processing
        const challengeResult = await Promise.race([
          processSingleChallenge(page, i),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Challenge processing timeout')), maxTimePerChallenge)
          )
        ]);
        
        if (challengeResult) {
          challenges.push(challengeResult);
        }
        
        const challengeEndTime = Date.now();
        console.log(`Challenge ${i + 1} completed in ${challengeEndTime - challengeStartTime}ms`);
        
      } catch (error) {
        console.error(`Error processing challenge card ${i + 1}:`, error.message);
        
        // Add a basic challenge object for failed extractions
        challenges.push({
          title: `Challenge ${i + 1}`,
          description: 'Error extracting challenge information',
          url: null,
          fullUrl: null,
          countdown: null,
          requiredCards: [],
          error: error.message,
          scrapedAt: new Date().toISOString()
        });
      }
    }
    
  } catch (error) {
    console.error("Error extracting challenges:", error);
  }
  
  return challenges;
};

/**
 * Process a single challenge (extracted from main function for timeout handling)
 */
const processSingleChallenge = async (page, challengeIndex) => {
  // Re-query the challenge cards to avoid stale element references
  const currentChallengeCards = await page.$$(CONFIG.selectors.challengeCard);
  const card = currentChallengeCards[challengeIndex];
  
  if (!card) {
    console.warn(`Challenge card ${challengeIndex + 1} not found, skipping`);
    return null;
  }
  
  // Extract basic info from the card before clicking
  const cardInfo = await page.evaluate((cardElement) => {
    const titleElement = cardElement.querySelector('h3.chakra-heading.css-1jbwuil');
    const descriptionElement = cardElement.querySelector('p.chakra-text.css-16naafx');
    const linkElement = cardElement.querySelector('a[href*="/challenges/"]');
    
    // Extract countdown information
    const countdownElements = cardElement.querySelectorAll('.css-dvxtzn h2.chakra-heading.css-kct8x3');
    let countdown = null;
    
    if (countdownElements.length >= 4) {
      const days = parseInt(countdownElements[0].textContent) || 0;
      const hours = parseInt(countdownElements[1].textContent) || 0;
      const minutes = parseInt(countdownElements[2].textContent) || 0;
      const seconds = parseInt(countdownElements[3].textContent) || 0;
      
      countdown = {
        days,
        hours,
        minutes,
        seconds,
        formatted: `${days}d ${hours}h ${minutes}m ${seconds}s`
      };
    }
    
    return {
      title: titleElement ? titleElement.textContent.trim() : 'Unknown Title',
      description: descriptionElement ? descriptionElement.textContent.trim() : 'No description',
      challengeUrl: linkElement ? linkElement.getAttribute('href') : null,
      countdown
    };
  }, card);
  
  if (!cardInfo.challengeUrl) {
    console.warn(`No challenge URL found for card ${challengeIndex + 1}, skipping`);
    return null;
  }
  
  console.log(`Found challenge: ${cardInfo.title}`);
  
  // Find and click the anchor element within the card
  const anchorElement = await card.$('a[href*="/challenges/"]');
  
  if (!anchorElement) {
    console.warn(`No anchor element found in card ${challengeIndex + 1}, skipping`);
    return null;
  }
  
  // Store the current URL to return to later
  const originalUrl = page.url();
  
  try {
    console.log(`Clicking on challenge: ${cardInfo.title}`);
    
    // Click the anchor element
    await anchorElement.click();
    
    // Wait for navigation to the challenge page
    await page.waitForNavigation({ 
      waitUntil: 'domcontentloaded', 
      timeout: CONFIG.timeouts.navigation 
    });
    
    console.log(`Navigated to challenge page: ${page.url()}`);
    
    // Wait for the challenge page to load
    await waitForTimeout(page, CONFIG.timeouts.challengePageLoad);
    
    // Extract required cards from the individual challenge page
    const requiredCards = await extractRequiredCardsFromCurrentPage(page);
    
    // Create the challenge object with all information
    const challenge = {
      title: cardInfo.title,
      description: cardInfo.description,
      url: cardInfo.challengeUrl,
      fullUrl: page.url(),
      countdown: cardInfo.countdown,
      requiredCards: requiredCards,
      scrapedAt: new Date().toISOString()
    };
    
    console.log(`✅ Successfully scraped challenge: ${challenge.title} (${requiredCards.length} required cards)`);
    
    // Navigate back to the original challenges page
    await navigateBackToMainPage(page, originalUrl);
    
    return challenge;
    
  } catch (navigationError) {
    console.error(`Failed to navigate to challenge ${cardInfo.title}:`, navigationError.message);
    
    // Try to navigate back even if challenge scraping failed
    try {
      await navigateBackToMainPage(page, originalUrl);
    } catch (backError) {
      console.error("Failed to navigate back after error:", backError.message);
    }
    
    // Create challenge object with error info
    return {
      title: cardInfo.title,
      description: cardInfo.description,
      url: cardInfo.challengeUrl,
      fullUrl: `https://nbatopshot.com${cardInfo.challengeUrl}`,
      countdown: cardInfo.countdown,
      requiredCards: [],
      error: navigationError.message,
      scrapedAt: new Date().toISOString()
    };
  }
};

/**
 * Navigate back to the main challenges page
 */
const navigateBackToMainPage = async (page, originalUrl) => {
  try {
    console.log("Navigating back to challenges page...");
    await page.goto(originalUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: CONFIG.timeouts.navigation 
    });
    
    // Wait for the page to load and challenges to be visible again
    await page.waitForSelector(CONFIG.selectors.challengeContainer, { timeout: CONFIG.timeouts.navigation });
    await waitForTimeout(page, 2000); // Give it a moment to fully load
    
    console.log("Successfully returned to challenges page");
    
  } catch (backNavigationError) {
    console.error("Failed to navigate back to challenges page:", backNavigationError.message);
    console.log("Attempting to reload the challenges page...");
    
    // Try to reload the challenges page
    await page.goto(CONFIG.url, { 
      waitUntil: 'domcontentloaded', 
      timeout: CONFIG.timeouts.navigation 
    });
    await page.waitForSelector(CONFIG.selectors.challengeContainer, { timeout: CONFIG.timeouts.navigation });
    await waitForTimeout(page, 2000);
  }
  
  // Add a small delay between processing challenges
  await waitForTimeout(page, 1000);
};

/**
 * Extract required cards from the current challenge page (already navigated to)
 */
const extractRequiredCardsFromCurrentPage = async (page) => {
  console.log(`Extracting required cards from current page: ${page.url()}`);
  
  try {
    const requiredCards = [];
    
    // Look for the specific card container structure you provided
    const cardContainers = await page.$$('.css-fzidx');
    
    if (cardContainers && cardContainers.length > 0) {
      console.log(`Found ${cardContainers.length} card containers`);
      
      for (let i = 0; i < cardContainers.length; i++) {
        try {
          const cardContainer = cardContainers[i];
          
          // Extract card information from the specific structure
          const cardInfo = await page.evaluate((container) => {
            // Look for the title element
            const titleElement = container.querySelector('p.chakra-text.css-1dfpog6');
            
            // Look for the rarity/description element
            const rarityElement = container.querySelector('p.chakra-text.css-3cntx8');
            
            const title = titleElement ? titleElement.textContent.trim() : '';
            const rarity = rarityElement ? rarityElement.textContent.trim() : '';
            
            // Only return if we found meaningful data
            if (title || rarity) {
              return {
                title: title,
                rarity: rarity,
                type: 'required_card'
              };
            }
            
            return null;
          }, cardContainer);
          
          if (cardInfo) {
            requiredCards.push(cardInfo);
            console.log(`Found required card: "${cardInfo.title}" - ${cardInfo.rarity}`);
          }
          
        } catch (error) {
          console.warn(`Error extracting card ${i + 1}:`, error.message);
        }
      }
    }
    
    // If no cards found with the specific structure, try fallback strategies
    if (requiredCards.length === 0) {
      console.log("No cards found with specific structure, trying fallback strategies...");
      
      // Fallback Strategy 1: Look for any elements with the card title class
      try {
        const titleElements = await page.$$('p.chakra-text.css-1dfpog6');
        const rarityElements = await page.$$('p.chakra-text.css-3cntx8');
        
        if (titleElements.length > 0) {
          console.log(`Found ${titleElements.length} title elements as fallback`);
          
          for (let i = 0; i < titleElements.length; i++) {
            try {
              const title = await titleElements[i].textContent();
              const rarity = i < rarityElements.length ? await rarityElements[i].textContent() : 'Unknown';
              
              if (title && title.trim()) {
                requiredCards.push({
                  title: title.trim(),
                  rarity: rarity.trim(),
                  type: 'required_card_fallback'
                });
                console.log(`Fallback found card: "${title.trim()}" - ${rarity.trim()}`);
              }
            } catch (error) {
              console.warn(`Error in fallback extraction ${i + 1}:`, error.message);
            }
          }
        }
      } catch (error) {
        console.warn("Fallback strategy 1 failed:", error.message);
      }
      
      // Fallback Strategy 2: Look for the parent container and extract all card info
      if (requiredCards.length === 0) {
        try {
          const parentContainer = await page.$('.css-1araarn');
          if (parentContainer) {
            const allCardInfo = await page.evaluate((container) => {
              const cards = [];
              const cardDivs = container.querySelectorAll('.css-fzidx');
              
              cardDivs.forEach((cardDiv) => {
                const titleEl = cardDiv.querySelector('p.chakra-text.css-1dfpog6');
                const rarityEl = cardDiv.querySelector('p.chakra-text.css-3cntx8');
                
                if (titleEl) {
                  cards.push({
                    title: titleEl.textContent.trim(),
                    rarity: rarityEl ? rarityEl.textContent.trim() : 'Unknown',
                    type: 'required_card_parent_search'
                  });
                }
              });
              
              return cards;
            }, parentContainer);
            
            if (allCardInfo && allCardInfo.length > 0) {
              requiredCards.push(...allCardInfo);
              console.log(`Parent container search found ${allCardInfo.length} cards`);
            }
          }
        } catch (error) {
          console.warn("Fallback strategy 2 failed:", error.message);
        }
      }
    }
    
    // Final fallback: Try to extract any text that might indicate requirements
    if (requiredCards.length === 0) {
      console.log("No specific cards found, trying text-based extraction...");
      
      try {
        const pageText = await Promise.race([
          page.evaluate(() => document.body.textContent),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Text extraction timeout')), 10000))
        ]);
        
        // Look for patterns that might indicate card requirements
        const cardPatterns = [
          /(?:require|need|must have)[\s\S]{0,200}(?:moment|card)/gi,
          /(?:rare|common|legendary|epic)[\s\S]{0,100}moment/gi,
          /(?:\d+\s*(?:rare|common|legendary|epic))/gi
        ];
        
        const foundRequirements = [];
        cardPatterns.forEach(pattern => {
          const matches = pageText.match(pattern);
          if (matches) {
            foundRequirements.push(...matches);
          }
        });
        
        if (foundRequirements.length > 0) {
          requiredCards.push({
            type: 'text_requirement',
            requirements: foundRequirements.map(req => req.trim()),
            title: 'Text-based requirements',
            rarity: 'Various'
          });
        }
      } catch (error) {
        console.warn("Error extracting text requirements:", error.message);
      }
    }
    
    console.log(`Extracted ${requiredCards.length} required cards/requirements`);
    
    // Log the cards found for debugging
    requiredCards.forEach((card, index) => {
      console.log(`  ${index + 1}. "${card.title}" - ${card.rarity} (${card.type})`);
    });
    
    return requiredCards;
    
  } catch (error) {
    console.error(`Error extracting required cards from current page:`, error);
    return [{ error: error.message, url: page.url() }];
  }
};

/**
 * Load more challenges if available
 */
const loadMoreChallenges = async (page) => {
  try {
    // Count challenges before clicking load more
    const challengeCountBefore = await page.$$eval(CONFIG.selectors.challengeCard, cards => cards.length).catch(() => 0);
    console.log(`Challenges visible before load more: ${challengeCountBefore}`);
    
    const loadMoreButton = await page.$(CONFIG.selectors.loadMoreButton);
    if (loadMoreButton) {
      // Check if button is visible and clickable
      const isVisible = await loadMoreButton.isIntersectingViewport();
      const isEnabled = await page.evaluate(btn => !btn.disabled && btn.offsetParent !== null, loadMoreButton);
      
      if (isVisible && isEnabled) {
        console.log("Found clickable 'Load More' button, clicking...");
        await loadMoreButton.click();
        await waitForTimeout(page, CONFIG.timeouts.loadMore);
        
        // Wait for new content to load and verify more challenges appeared
        let retries = 0;
        const maxRetries = 5;
        let challengeCountAfter = challengeCountBefore;
        
        while (challengeCountAfter <= challengeCountBefore && retries < maxRetries) {
          await waitForTimeout(page, 1000); // Wait 1 second
          challengeCountAfter = await page.$$eval(CONFIG.selectors.challengeCard, cards => cards.length).catch(() => 0);
          retries++;
          console.log(`Retry ${retries}: Challenges after load more: ${challengeCountAfter}`);
        }
        
        if (challengeCountAfter > challengeCountBefore) {
          console.log(`Successfully loaded ${challengeCountAfter - challengeCountBefore} more challenges`);
          return true;
        } else {
          console.log("No new challenges loaded after clicking 'Load More' - assuming end reached");
          return false;
        }
      } else {
        console.log("Load More button found but not clickable");
        return false;
      }
    } else {
      console.log("No 'Load More' button found");
      return false;
    }
  } catch (error) {
    console.warn("Error in loadMoreChallenges:", error.message);
    return false;
  }
};

/**
 * Scrape all challenges with their required cards
 */
const scrapeAllChallenges = async (page) => {
  console.log("Starting comprehensive challenge scraping...");
  
  let allChallenges = [];
  let hasMoreChallenges = true;
  let pageNumber = 1;
  const maxPages = 10; // Safety limit to prevent infinite loops
  let consecutiveEmptyPages = 0;
  const maxConsecutiveEmptyPages = 3;
  
  // Load all available challenges
  while (hasMoreChallenges && pageNumber <= maxPages) {
    console.log(`Processing challenges page ${pageNumber}...`);
    
    // Extract challenges from current page (this now includes clicking and scraping individual pages)
    const challenges = await extractChallengeInfo(page);
    
    if (challenges.length > 0) {
      allChallenges = [...allChallenges, ...challenges];
      console.log(`Processed ${challenges.length} challenges from page ${pageNumber}`);
      consecutiveEmptyPages = 0; // Reset counter when we find challenges
    } else {
      console.log(`No challenges found on page ${pageNumber}`);
      consecutiveEmptyPages++;
      
      // If we've had too many consecutive empty pages, stop
      if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
        console.log(`Stopping after ${consecutiveEmptyPages} consecutive empty pages`);
        break;
      }
    }
    
    // Try to load more challenges
    console.log("Checking for 'Load More' button...");
    hasMoreChallenges = await loadMoreChallenges(page);
    
    if (hasMoreChallenges) {
      pageNumber++;
      console.log(`Loading more challenges (page ${pageNumber})...`);
      // Wait for new challenges to load
      await waitForTimeout(page, CONFIG.timeouts.loadMore);
      
      // Additional safety check: verify new challenges actually loaded
      const challengeCountAfterLoad = await page.$$eval(CONFIG.selectors.challengeCard, cards => cards.length);
      console.log(`Challenge cards visible after load more: ${challengeCountAfterLoad}`);
      
    } else {
      console.log("No 'Load More' button found - reached end of challenges");
      break;
    }
    
    // Safety check: if we've been running too long, break
    if (pageNumber > maxPages) {
      console.log(`Reached maximum page limit (${maxPages}), stopping to prevent infinite loop`);
      break;
    }
  }
  
  console.log(`Total challenges processed: ${allChallenges.length}`);
  console.log(`Pages processed: ${pageNumber}`);
  return allChallenges;
};

/**
 * Save challenges data to JSON file
 */
const saveChallengesData = (challenges) => {
  const filename = `challenges_${new Date().toISOString().split('T')[0]}.json`;
  
  try {
    fs.writeFileSync(filename, JSON.stringify(challenges, null, 2));
    console.log(`Challenges data saved to: ${filename}`);
  } catch (error) {
    console.error("Error saving challenges data:", error);
  }
};

// ============================================================================
// MAIN EXECUTION
// ============================================================================

const main = async () => {
  let browser;
  
  try {
    console.log("Starting NBA Top Shot challenge scraper...");
    
    // Load cookies (if available)
    const cookies = loadCookies();
    
    // Setup browser and page
    const { browser: browserInstance, page } = await setupBrowser();
    browser = browserInstance;
    
    // Setup network monitoring
    setupNetworkMonitoring(page);
    
    // Navigate to the challenges page
    try {
      await navigateToPage(page);
    } catch (navigationError) {
      console.error("Failed to navigate to challenges page:", navigationError.message);
      console.log("Attempting to continue with current page state...");
    }
    
    // Perform login
    console.log("Performing login...");
    try {
      await performLogin(page);
    } catch (loginError) {
      console.error("Login failed:", loginError.message);
      console.log("Continuing without login - some challenges may not be accessible");
    }
    
    // Wait for page to fully load after login
    await waitForTimeout(page, CONFIG.timeouts.pageLoad);
    
    // Scrape all challenges
    console.log("Starting challenge scraping...");
    const challenges = await scrapeAllChallenges(page);
    
    if (challenges.length === 0) {
      console.warn("No challenges were scraped. This might indicate:");
      console.warn("- Page didn't load properly");
      console.warn("- Selectors need updating");
      console.warn("- Site structure has changed");
      console.warn("- Network issues");
      
      // Try to get page info for debugging
      try {
        const currentUrl = page.url();
        const pageTitle = await page.title();
        console.log(`Current URL: ${currentUrl}`);
        console.log(`Page title: ${pageTitle}`);
        
        // Check if we can find any challenge-related elements
        const anyElements = await page.$$('div, section, article');
        console.log(`Found ${anyElements.length} total elements on page`);
        
      } catch (debugError) {
        console.warn("Could not get debug info:", debugError.message);
      }
    } else {
      // Save the data
      saveChallengesData(challenges);
      
      // Log summary
      console.log("\n=== SCRAPING SUMMARY ===");
      console.log(`Total challenges scraped: ${challenges.length}`);
      
      let successfulChallenges = 0;
      let failedChallenges = 0;
      
      challenges.forEach((challenge, index) => {
        console.log(`${index + 1}. ${challenge.title}`);
        console.log(`   Description: ${challenge.description.substring(0, 100)}...`);
        
        if (challenge.error) {
          console.log(`   ❌ Error: ${challenge.error}`);
          failedChallenges++;
        } else {
          console.log(`   Required cards: ${challenge.requiredCards.length}`);
          console.log(`   Countdown: ${challenge.countdown?.formatted || 'N/A'}`);
          successfulChallenges++;
        }
        console.log('');
      });
      
      console.log(`✅ Successfully processed: ${successfulChallenges}`);
      console.log(`❌ Failed to process: ${failedChallenges}`);
    }
    
    console.log("Scraping completed");
    
  } catch (error) {
    console.error("Error during scraping:", error);
    console.error("Stack trace:", error.stack);
  } finally {
    // Cleanup
    if (browser) {
      console.log("Closing browser...");
      // await browser.close(); // Uncomment when ready to auto-close
    }
  }
};

// Start the application
main();


