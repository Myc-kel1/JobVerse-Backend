require("dotenv").config();

const appId = process.env.ADZUNA_APP_ID;
const appKey = process.env.ADZUNA_APP_KEY;

console.log("ADZUNA_APP_ID exists:", !!appId);
console.log("ADZUNA_APP_KEY exists:", !!appKey);

console.log("APP_ID length:", appId ? appId.length : 0);
console.log("APP_KEY length:", appKey ? appKey.length : 0);