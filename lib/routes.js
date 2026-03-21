const path = require('path');
const { registerMediaRoutes } = require('./mediaRoutes');

function registerRoutes(app, { service, config }) {
    registerMediaRoutes(app, { config });

    app.get('/', (req, res) => {
        res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
    });

    app.get('/api/downloads', async (req, res) => {
        try {
            const snapshot = await service.getDownloadsSnapshot();
            res.json(snapshot);
        } catch (error) {
            res.status(503).json(service.getUnavailableSnapshot(error));
        }
    });

    app.post('/api/downloads', async (req, res) => {
        const rawUrl = String(req.body.url || '').trim();
        const rawSubfolder = String(req.body.subfolder || '').trim();

        if (!rawUrl) {
            res.status(400).json({ error: 'A download URL is required.' });
            return;
        }

        try {
            service.validateSupportedUrl(rawUrl);
        } catch (error) {
            res.status(400).json({ error: error.message || 'Invalid URL.' });
            return;
        }

        try {
            const result = await service.addDownload(rawUrl, rawSubfolder);
            res.status(201).json(result);
        } catch (error) {
            const statusCode = /subfolder/i.test(String(error.message || '')) ? 400 : 503;
            res.status(statusCode).json({ error: error.message || 'Unable to add download.' });
        }
    });

    app.post('/api/downloads/:gid/:action', async (req, res) => {
        const gid = String(req.params.gid || '').trim();
        const action = String(req.params.action || '').trim().toLowerCase();

        if (!gid) {
            res.status(400).json({ error: 'A download gid is required.' });
            return;
        }

        if (!['pause', 'resume', 'remove'].includes(action)) {
            res.status(400).json({ error: 'Unsupported action.' });
            return;
        }

        try {
            await service.ensureReady();
            await service.applyDownloadAction(gid, action);
            res.json({ message: `Download ${action} applied.` });
        } catch (error) {
            res.status(400).json({ error: error.message || `Unable to ${action} download.` });
        }
    });
}

module.exports = {
    registerRoutes
};
