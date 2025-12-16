import fastify = require('fastify');
const {getWalletBalance, creditWallet} = require('./db/modules/wallet/wallet.service');

const server = fastify()

server.get('/payments/health', async (req: any, res: any) => {
    return { status: 'ok' }
})

server.get('/wallet/:userId', async (req:any, res: any) => {
    const balance = await getWalletBalance(req.params.userId);
    return { balance }
})

server.post('/payments/wallet/deposit', async (req: any, res: any) => {
    // Logic to deposit amount into wallet
})

server.listen({port: 8080}, (err, address) => {
    if (err) {
        console.error(err)
        process.exit(1)
    }
    console.log(`Server listening at ${address}`)
})