// P3-2: Auth.js v5 (next-auth) module augmentation - the bridge route reads
// the OAuth provider identity (provider + providerAccountId) off the Auth.js
// session to resolve/link the local account. DefaultSession/DefaultJWT keep
// the standard fields; only the two OAuth claims are added.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** OAuth provider name ("google" | "github"), set on the Auth.js JWT
       *  by the jwt callback and surfaced through the session callback. */
      oauthProvider?: string;
      /** Provider-side account id (Google sub / GitHub numeric id). */
      oauthProviderId?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    oauthProvider?: string;
    oauthProviderId?: string;
  }
}
