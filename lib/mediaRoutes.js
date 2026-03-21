const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.flv', '.wmv', '.ts', '.mpeg', '.mpg'
]);

function isVideoFile(filePath) {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    return VIDEO_EXTENSIONS.has(extension);
}

function normalizeRelativePath(value) {
    return String(value || '')
        .split('/')
        .filter(Boolean)
        .join(path.sep);
}

function toMediaUrlFromAbsolutePath(filePath, downloadDir) {
    const relativePath = path.relative(downloadDir, filePath);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return '';
    }

    const encodedPath = relativePath
        .split(path.sep)
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');

    return encodedPath ? `/media/${encodedPath}` : '';
}

function walkDirectoryRecursive(rootDir) {
    const files = [];
    const stack = [rootDir];

    while (stack.length) {
        const currentDir = stack.pop();
        let entries = [];

        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);

            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (entry.isFile()) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

function getVideoFilesSnapshot(downloadDir) {
    const files = walkDirectoryRecursive(downloadDir);
    const videos = [];

    for (const filePath of files) {
        if (!isVideoFile(filePath)) {
            continue;
        }

        let stats;
        try {
            stats = fs.statSync(filePath);
        } catch {
            continue;
        }

        const viewUrl = toMediaUrlFromAbsolutePath(filePath, downloadDir);

        if (!viewUrl) {
            continue;
        }

        videos.push({
            name: path.basename(filePath),
            relativePath: path.relative(downloadDir, filePath).replace(/\\/g, '/'),
            size: Number(stats.size || 0),
            modifiedAt: stats.mtime.toISOString(),
            viewUrl
        });
    }

    videos.sort((left, right) => {
        const leftTime = Date.parse(left.modifiedAt) || 0;
        const rightTime = Date.parse(right.modifiedAt) || 0;
        return rightTime - leftTime;
    });

    return videos;
}

function registerMediaRoutes(app, { config }) {
    app.get('/api/files', (req, res) => {
        try {
            const files = getVideoFilesSnapshot(config.DOWNLOAD_DIR);
            res.json({ files });
        } catch {
            res.status(500).json({ error: 'Unable to read downloaded files.', files: [] });
        }
    });

    app.get('/media/*', (req, res) => {
        const rawRelativePath = req.params[0] || '';

        let decodedPath = '';
        try {
            decodedPath = decodeURIComponent(rawRelativePath);
        } catch {
            res.status(400).send('Invalid media path.');
            return;
        }

        const normalizedPath = normalizeRelativePath(decodedPath);

        if (!normalizedPath || !isVideoFile(normalizedPath)) {
            res.status(404).send('Video file not found.');
            return;
        }

        res.sendFile(normalizedPath, {
            root: config.DOWNLOAD_DIR,
            dotfiles: 'deny',
            acceptRanges: true,
            cacheControl: true,
            maxAge: '5m'
        }, (error) => {
            if (error && !res.headersSent) {
                res.status(error.statusCode || 404).send('Video file not found.');
            }
        });
    });
}

module.exports = {
    isVideoFile,
    getVideoFilesSnapshot,
    registerMediaRoutes
};