import { headers } from "next/headers";
import { authMode, entraUser } from "./app-auth";

export type AdminUser = {
  email: string;
  name?: string;
  isLocalFallback?: boolean;
};

export function adminEmails() {
  const configured = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
  const values = configured
    .split(/[;,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return values;
}

export function userFromHeaderMap(headerMap: Headers): AdminUser | null {
  const mode = authMode();
  if (mode === "entra") {
    const user = entraUser(headerMap);
    return user?.email ? { email: user.email, name: user.name } : null;
  }
  if (mode === "none" && process.env.ADMIN_LOCAL_BYPASS !== "false" && adminEmails().length > 0) {
    const fallback = adminEmails()[0];
    return { email: fallback, name: fallback, isLocalFallback: true };
  }
  return null;
}

export async function currentAdminUser() {
  const user = userFromHeaderMap(await headers());
  if (!user) return null;
  return adminEmails().includes(user.email) ? user : null;
}

export function isAdminRequest(headerMap: Headers) {
  const user = userFromHeaderMap(headerMap);
  return !!user && adminEmails().includes(user.email);
}
