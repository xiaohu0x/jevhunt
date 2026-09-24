import { getSession } from "./auth.js";
export function isAdmin(user, env) {
  const allowed = (env.ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  return !!user && allowed.includes(user.email.toLowerCase());
}
export async function adminSession(request, env) {
  const session = await getSession(request, env);
  return session && isAdmin(session.user, env) ? session : null;
}
