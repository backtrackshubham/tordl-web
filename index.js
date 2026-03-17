const express = require('express');
const config = require('./lib/config');
const { Aria2Service } = require('./lib/aria2Service');
const { registerRoutes } = require('./lib/routes');
const { attachShutdownHandlers } = require('./lib/shutdown');

const app = express();
const aria2Service = new Aria2Service(config);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(config.PUBLIC_DIR));

registerRoutes(app, {
    service: aria2Service,
    config
});

const httpServer = app.listen(config.PORT, async () => {
    console.log(`Server running at http://localhost:${config.PORT}`);

    try {
        await aria2Service.ensureReady();
        console.log(`aria2 RPC ready at http://${config.ARIA2_HOST}:${config.ARIA2_PORT}/jsonrpc`);
    } catch (error) {
        console.error(error.message);
    }
});

attachShutdownHandlers({
    server: httpServer,
    stopService: () => aria2Service.stop()
});
