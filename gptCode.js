// unused

import puppeteerExtra from "puppeteer-extra";

import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Adblocker from "puppeteer-extra-plugin-adblocker";
// import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
// import { generateProxyUrl } from './proxy';




const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const USER_DATA_DIR =
  process.env.USER_DATA_DIR ||
  `/tmp/chrome-user-data-${Math.floor(Math.random() * 100000)}`;
const NO_PROXY = process.env.NO_PROXY || false;

async function scrapeMoments() {
  puppeteerExtra.use(Adblocker());
  puppeteerExtra.use(StealthPlugin());

  let args = [
    " --user-agent='" + USER_AGENT + "'",
    " --crash-dumps-dir=/tmp",
    " --no-sandbox",
    " --no-zygote",
    " --disable-background-timer-throttling",
    " --disable-backgrounding-occluded-windows",
    " --disable-renderer-backgrounding",
    " --user-data-dir=" + USER_DATA_DIR,
  ];

  let newProxyUrl = null;

//   if (!NO_PROXY) {
//     newProxyUrl = await anonymizeProxy(generateProxyUrl());
//     args.push(" --proxy-server=" + newProxyUrl);
//   }

  const browser = await puppeteerExtra.launch({ headless: true, args: args });

  // Open a new page
  const page = await browser.newPage();

  //   const browser = await puppeteer.launch({ headless: true });
  //   const page = await browser.newPage();
  await page.goto("https://nbatopshot.com/user/@econn811/moments", {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // Function to scroll to the bottom of the page and wait for new content to load
  async function autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
  }

  // Array to store the moments information
  let moments = [];
  let previousHeight;

  while (true) {
    try {
      previousHeight = await page.evaluate("document.body.scrollHeight");
      await autoScroll(page);
      await page.waitForFunction(
        `document.body.scrollHeight > ${previousHeight}`,
        { timeout: 60000 }
      );
    //   await page.waitForTimeout(2000); // Wait for 2 seconds to ensure content is loaded

      // Extract the moments information
      let newMoments = await page.evaluate(() => {
        let items = [];
        document
          .querySelectorAll("p.chakra-text.css-17udwdn")
          .forEach((item) => {
            items.push(item.innerHTML);
          });
        return items;
      });

      if (newMoments.length === 0) break;
      moments = moments.concat(newMoments);
    } catch (error) {
      console.error("Error during scraping:", error);
      break;
    }
  }

  console.log(moments);

  await browser.close();
}

scrapeMoments();
