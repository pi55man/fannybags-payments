import fastify = require('fastify');
import pool = require('./db/pool');
import apiRoutes = require('./routes/api');
import webhookRoutes = require('./routes/webhooks');
import campaignService = require('./db/modules/campaigns/campaign.service');

const server = fastify({
    logger: true,
});

server.register(apiRoutes);
server.register(webhookRoutes);

server.get('/health', async (req: any, res: any) => {
    return { status: 'ok' };
});

// deadline worker - run periodically via cron or scheduler
async function runDeadlineWorker() {
    try {
        await campaignService.deadlineWorker(pool);
        console.log('deadline worker completed');
    } catch (error) {
        console.error('deadline worker failed:', error);
    }
}

// run worker every 5 minutes
setInterval(runDeadlineWorker, 5 * 60 * 1000);

server.listen({ port: parseInt(process.env.PORT || '8080', 10), host: '0.0.0.0' }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`server listening at ${address}`);
    // run worker on startup
    runDeadlineWorker();
});
