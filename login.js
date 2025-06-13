export async function performLogin(page) {
  const loginButtons = await page.$$(".chakra-button.css-1ult5od");
  if (loginButtons.length > 1) {
    await loginButtons[1].click();
    await page.waitForNavigation({ waitUntil: "load" });
    await new Promise((resolve) => setTimeout(resolve, 5000));
    
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      const email = process.env.NBA_TOPSHOT_EMAIL;
      if (!email) {
        throw new Error("NBA_TOPSHOT_EMAIL environment variable is required");
      }
      await emailInput.type(email);
    } else {
      console.log("Email input not found");
    }
    
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      const password = process.env.NBA_TOPSHOT_PASSWORD;
      if (!password) {
        throw new Error("NBA_TOPSHOT_PASSWORD environment variable is required");
      }
      await passwordInput.type(password);
    } else {
      console.log("Password input not found");
    }
    
    const loginButton = await page.$("#login");
    if (loginButton) {
      await loginButton.click();
    } else {
      console.log("Login button not found");
    }
  } else {
    console.log("second login button not found");
  }
}