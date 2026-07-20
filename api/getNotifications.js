import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";

/**
 * Edge-cached proxy for a user's notification list, scoped to a workspace.
 * Mirrors api/getStaff.js. The cache key includes the query string, so each
 * (email, workspace) pair caches independently.
 */
export default async function handler(req, res) {
  const convexUrl = process.env.VITE_CONVEX_URL || "https://honorable-ostrich-665.convex.cloud";
  const client = new ConvexHttpClient(convexUrl);

  const email = req.query.email || "";
  const workspace = req.query.workspace || "workforce";

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  try {
    const notifications = await client.query(api.notifications.getNotifications, { email, workspace });

    // Cache per (email, workspace) for 30s to save Convex bandwidth while
    // keeping the bell reasonably fresh.
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate");
    res.status(200).json(notifications);
  } catch (error) {
    console.error("Vercel Notifications Proxy Error:", error);
    res.status(500).json({ error: error.message });
  }
}
