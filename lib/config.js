const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

module.exports = {
    ROOT_DIR,
    PORT: 31345,
    DOWNLOAD_DIR: path.join(ROOT_DIR, 'downloads'),
    PUBLIC_DIR: path.join(ROOT_DIR, 'public'),
    SESSION_FILE: path.join(ROOT_DIR, 'aria2.session'),
    ARIA2_HOST: '127.0.0.1',
    ARIA2_PORT: 6800,
    MAX_CONCURRENT_DOWNLOADS: 5,
    STATUS_KEYS: [
        'gid',
        'status',
        'totalLength',
        'completedLength',
        'downloadSpeed',
        'uploadSpeed',
        'connections',
        'dir',
        'errorCode',
        'errorMessage',
        'files',
        'bittorrent'
    ]
};
