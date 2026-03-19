// Run this once with: bun run get-google-token.ts
// It will open your browser for authorization, then print the refresh token.

import { serve } from "bun";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8844/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env");
  process.exit(1);
}

// Step 1: Build the auth URL
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\n=== Google OAuth Token Helper ===\n");
console.log("Open this URL in your browser:\n");
console.log(authUrl.toString());
console.log("\nWaiting for callback on http://localhost:8844 ...\n");

// Step 2: Start a temporary server to catch the callback
const server = serve({
  port: 8844,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
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
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID!,
          client_secret: CLIENT_SECRET!,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokens = await tokenRes.json();

      if (tokens.refresh_token) {
        console.log("=== SUCCESS ===\n");
        console.log("Add this to your .env file:\n");
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log("\n================\n");
      } else {
        console.log("Token response (no refresh_token):", tokens);
        console.log(
          "\nTip: Make sure prompt=consent is set and you haven't already authorized this app."
        );
      }

      server.stop();
      return new Response(
        "<h1>Done!</h1><p>Check your terminal for the refresh token. You can close this tab.</p>",
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response("Waiting for OAuth callback...", { status: 200 });
  },
});
