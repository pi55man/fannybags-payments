import dist = require("redis");

const client = dist.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

let isConnected = false;

async function ensureConnected(): Promise<void> {
    if (!isConnected) {
        await client.connect();
        isConnected = true;
    }
}

async function getIdemLock(idemKey: string, ttlSeconds = 300): Promise<boolean> {
    try {
        await ensureConnected();
        const result = await client.set(idemKey, "1", { NX: true, EX: ttlSeconds });
        return result === "OK";
    } catch (error) {
        console.error('redis idempotency lock failed:', error);
        return false;
    }
}

async function releaseIdemLock(idemKey: string): Promise<void> {
    try {
        await ensureConnected();
        await client.del(idemKey);
    } catch (error) {
        console.error('redis idempotency release failed:', error);
    }
}

export = { getIdemLock, releaseIdemLock, ensureConnected };