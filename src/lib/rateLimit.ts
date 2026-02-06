// Simple in-memory rate limiter for API routes
const requestCounts = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of requestCounts) {
        if (now > value.resetAt) {
            requestCounts.delete(key);
        }
    }
}, 5 * 60 * 1000);

/**
 * Check if a request should be rate limited.
 * @param key - Unique identifier (e.g., IP address or sessionId)
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns true if the request should be ALLOWED, false if rate limited
 */
export function checkRateLimit(key: string, maxRequests: number = 30, windowMs: number = 60000): boolean {
    const now = Date.now();
    const entry = requestCounts.get(key);

    if (!entry || now > entry.resetAt) {
        requestCounts.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }

    entry.count++;
    if (entry.count > maxRequests) {
        return false;
    }

    return true;
}
