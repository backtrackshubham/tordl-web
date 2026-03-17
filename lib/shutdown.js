function attachShutdownHandlers({ server, stopService }) {
    const serverSockets = new Set();
    let isShuttingDown = false;

    server.on('connection', (socket) => {
        serverSockets.add(socket);
        socket.on('close', () => {
            serverSockets.delete(socket);
        });
    });

    const closeHttpServer = () => new Promise((resolve) => {
        for (const socket of serverSockets) {
            socket.destroy();
        }

        server.close(() => {
            resolve();
        });
    });

    const shutdown = async (signal) => {
        if (isShuttingDown) {
            return;
        }

        isShuttingDown = true;
        console.log(`Received ${signal}, shutting down...`);

        const forceExitTimer = setTimeout(() => {
            process.exit(1);
        }, 3000);

        forceExitTimer.unref();

        await Promise.all([stopService(), closeHttpServer()]);
        process.exit(0);
    };

    process.on('SIGINT', () => {
        void shutdown('SIGINT');
    });

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM');
    });
}

module.exports = {
    attachShutdownHandlers
};
