// P3-2: Auth.js v5 route handlers (OAuth signin/callback/providers/etc).
// The provider dance lives under /api/auth/* (signin, callback, csrf,
// session, providers) - the app's own /api/auth/login (password) and
// /api/auth/me (session) routes are untouched and stay the single source of
// truth for the kai-token session.
import { handlers } from "@/lib/auth/authjs";

export const { GET, POST } = handlers;
