import { ConvexHttpClient } from "convex/browser";
import { anyApi as api } from "convex/server";

export default async function handler(req, res) {
  // Use the production URL from environment variables
  const convexUrl = process.env.VITE_CONVEX_URL || "https://honorable-ostrich-665.convex.cloud";
  const client = new ConvexHttpClient(convexUrl);

  try {
    const staff = await client.query(api.staff.getStaff);
    
    // CACHE MGC: This is the secret sauce. 
    // We tell Vercel to cache this list for 60 seconds.
    // Even if 100 people open the app, Convex only gets hit ONCE per minute.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    
    res.status(200).json(staff);
  } catch (error) {
    console.error("Vercel Staff Proxy Error:", error);
    res.status(500).json({ error: error.message });
  }
}
