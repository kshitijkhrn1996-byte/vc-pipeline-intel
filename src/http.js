// Shared helpers for the Vercel functions.

// The dashboard is open unless DASHBOARD_KEY is set; then requests must carry ?key=.
export function isOwner(req) {
  return !process.env.DASHBOARD_KEY || req.query?.key === process.env.DASHBOARD_KEY;
}

// Wraps a handler with owner auth, no-store caching and JSON errors.
export function ownerRoute(fn) {
  return async (req, res) => {
    if (!isOwner(req)) return res.status(401).json({ error: 'unauthorised' });
    res.setHeader('Cache-Control', 'no-store');
    try {
      await fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({ error: String(err.message || err) });
    }
  };
}

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
