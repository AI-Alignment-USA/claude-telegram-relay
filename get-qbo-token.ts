// Run this once with: bun run get-qbo-token.ts
// It will open your browser for authorization, then print the refresh token and realmId.

import { serve } from "bun";

const CLIENT_ID = process.env.QBO_CLIENT_ID;
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8845/callback";
const SCOPES = "com.intuit.quickbooks.accounting";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing QBO_CLIENT_ID or QBO_CLIENT_SECRET in .env");
  process.exit(1);
}

// Step 1: Build the auth URL
const authUrl = new URL("https://appcenter.intuit.com/connect/oauth2");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("state", "tamille-cfo");

console.log("\n=== QuickBooks OAuth Token Helper ===\n");
console.log("Open this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting for callback on http://localhost:8845 ...\n");

// Step 2: Start a temporary server to catch the callback
const server = serve({
  port: 8845,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      const realmId = url.searchParams.get("realmId");
      const error = url.searchParams.get("error");

      if (error) {
        console.error("Authorization error:", error);
        server.stop();
        return new Response("Authorization failed. Check your terminal.", {
          status: 400,
        });
      }

      if (!code) {
        return new Response("No code received", { status: 400 });
      }

      // Step 3: Exchange code for tokens
      const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
        "base64"
      );

      const tokenRes = await fetch(
        "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            code,
            redirect_uri: REDIRECT_URI,
            grant_type: "authorization_code",
          }),
        }
      );

      const tokens = await tokenRes.json();

      if (tokens.refresh_token) {
        console.log("=== SUCCESS ===\n");
        console.log("Add these to your .env file:\n");
        console.log(`QBO_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log(`QBO_REALM_ID=${realmId}`);
        console.log("\n================\n");
      } else {
        console.log("Token response (no refresh_token):", tokens);
      }

      server.stop();
      return new Response(
        "<h1>Done!</h1><p>Check your terminal for the refresh token and realmId. You can close this tab.</p>",
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response("Waiting for OAuth callback...", { status: 200 });
  },
});
