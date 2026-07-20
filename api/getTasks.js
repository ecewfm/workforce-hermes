import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";

export default async function handler(req, res) {
  const convexUrl = process.env.VITE_CONVEX_URL || "https://honorable-ostrich-665.convex.cloud";
  const client = new ConvexHttpClient(convexUrl);

  try {
    const tasks = await client.query(api.tasks.getTasksLight);
    
    // Cache tasks for 30 seconds. This makes the Kanban board snappy 
    // and saves massive Convex bandwidth.
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    
    res.status(200).json(tasks);
  } catch (error) {
    console.error("Vercel Tasks Proxy Error:", error);
    res.status(500).json({ error: error.message });
  }
}
