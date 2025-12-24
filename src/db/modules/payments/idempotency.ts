import nodeHttp2 = require("node:http2");
import dist = require("redis")

const {CreateClient} = require("redis")
const client = dist.createClient();

async function connectRedis(){
    await client.connect();
    return client
}

async function getIdemLock(idemKey: string, ttlSeconds = 300): Promise<boolean>{
    let client = await connectRedis();
    const result = await client.set(idemKey,"1",{NX:true, EX:ttlSeconds}); 
    //NX: set if not exists
    //EX: expire time in seconds
    return result === "OK";
}

export = {getIdemLock, connectRedis};