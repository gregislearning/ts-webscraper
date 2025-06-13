# NBA Top Shot Challenge Scraper

A comprehensive web scraper built with Puppeteer to extract challenge information and required cards from NBA Top Shot challenges page.

## Features

- 🎯 **Comprehensive Challenge Scraping**: Extracts challenge titles, descriptions, countdown timers, and required cards
- 🔄 **Smart Navigation**: Clicks through individual challenge pages to gather detailed information
- 🛡️ **Robust Error Handling**: Includes retry logic, timeout protection, and graceful error recovery
- 📊 **Structured Data Output**: Saves all scraped data to timestamped JSON files
- 🚀 **Anti-Detection**: Uses stealth plugins and realistic browser behavior
- ⚡ **Loop Prevention**: Built-in safeguards to prevent infinite loops and timeouts

## Project Structure

```
├── challengeScraper.js    # Main scraper with comprehensive challenge extraction
├── login.js              # Authentication handling
├── index.js              # Alternative scraper implementation
├── server.js             # Express server for web interface
├── package.json          # Project dependencies
├── cookies.json          # Stored authentication cookies (gitignored)
└── challenges_*.json     # Scraped data output (gitignored)
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/gregislearning/ts-webscraper.git
cd ts-webscraper
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

## Usage

### Main Challenge Scraper

Run the comprehensive challenge scraper:

```bash
node challengeScraper.js
```

This will:
1. Navigate to NBA Top Shot challenges page
2. Perform authentication
3. Extract all visible challenges
4. Click into each challenge to get required cards
5. Save data to `challenges_YYYY-MM-DD.json`

### Data Structure

Each scraped challenge includes:

```javascript
{
  "title": "Challenge Name",
  "description": "Challenge description text",
  "url": "/challenges/uuid",
  "fullUrl": "https://nbatopshot.com/challenges/uuid",
  "countdown": {
    "days": 5,
    "hours": 22,
    "minutes": 34,
    "seconds": 55,
    "formatted": "5d 22h 34m 55s"
  },
  "requiredCards": [
    {
      "title": "2025 NBA Playoffs: Thunder or Pacers Rare Moment",
      "rarity": "Rare Moment",
      "type": "required_card"
    }
  ],
  "scrapedAt": "2024-01-15T10:30:00.000Z"
}
```

## Configuration

The scraper includes several configurable options in `challengeScraper.js`:

```javascript
const CONFIG = {
  url: "https://nbatopshot.com/challenges",
  viewport: { width: 1920, height: 1080 },
  timeouts: {
    pageLoad: 5000,
    challengePageLoad: 3000,
    navigation: 60000,
    retry: 2000,
  },
  retries: {
    navigation: 3,
    extraction: 2,
  }
};
```

## Safety Features

- **Maximum page limits**: Prevents infinite pagination
- **Challenge timeouts**: 60-second max per challenge
- **Consecutive empty page detection**: Stops after 3 empty pages
- **Load more verification**: Confirms new challenges actually loaded
- **Graceful error handling**: Continues scraping even if individual challenges fail

## Dependencies

- **puppeteer-extra**: Enhanced Puppeteer with plugins
- **puppeteer-extra-plugin-stealth**: Anti-detection measures
- **puppeteer-extra-plugin-adblocker**: Ad blocking for faster loading
- **@supabase/supabase-js**: Database integration (optional)

## Authentication

The scraper handles authentication through the `login.js` module. Make sure to:

1. Have valid NBA Top Shot credentials
2. Update the login logic if needed
3. Cookies are automatically saved for subsequent runs

## Output

Scraped data is saved to timestamped JSON files:
- `challenges_2024-01-15.json`
- Console output with detailed progress and summary

## Error Handling

The scraper includes comprehensive error handling:
- Navigation timeouts
- Missing elements
- Stale element references
- Network issues
- Individual challenge failures

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is for educational purposes. Please respect NBA Top Shot's terms of service and rate limits.

## Disclaimer

This scraper is intended for educational and research purposes only. Users are responsible for complying with NBA Top Shot's terms of service and applicable laws. Use responsibly and respect rate limits. 