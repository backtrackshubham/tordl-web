const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

class Aria2Service {
    constructor(config) {
        this.config = config;
        this.aria2Process = null;
        this.aria2Ready = false;
        this.aria2StartupError = '';
        this.aria2StartingPromise = null;

        fs.mkdirSync(this.config.DOWNLOAD_DIR, { recursive: true });

        if (!fs.existsSync(this.config.SESSION_FILE)) {
            fs.writeFileSync(this.config.SESSION_FILE, '', 'utf8');
        }
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    toNumber(value) {
        const numeric = Number(value || 0);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    getNameFromUri(uri, fallback) {
        if (!uri) {
            return fallback;
        }

        try {
            const parsed = new URL(uri);
            const pathname = parsed.pathname || '';
            const lastSegment = pathname.split('/').filter(Boolean).pop();
            return lastSegment || parsed.hostname || fallback;
        } catch {
            return fallback;
        }
    }

    resolveDownloadDir(subfolder) {
        if (!subfolder) {
            return this.config.DOWNLOAD_DIR;
        }

        const normalized = String(subfolder)
            .trim()
            .replace(/\\/g, '/')
            .replace(/^\/+|\/+$/g, '');

        if (!normalized) {
            return this.config.DOWNLOAD_DIR;
        }

        if (normalized.length > 120) {
            throw new Error('Subfolder name is too long. Keep it within 120 characters.');
        }

        const segments = normalized.split('/').filter(Boolean);

        if (!segments.length) {
            return this.config.DOWNLOAD_DIR;
        }

        for (const segment of segments) {
            if (segment === '.' || segment === '..') {
                throw new Error('Subfolder cannot contain relative path segments.');
            }

            if (/[<>:"|?*]/.test(segment)) {
                throw new Error('Subfolder contains invalid characters.');
            }
        }

        const finalDir = path.join(this.config.DOWNLOAD_DIR, ...segments);
        fs.mkdirSync(finalDir, { recursive: true });
        return finalDir;
    }

    formatDownload(download) {
        const totalLength = this.toNumber(download.totalLength);
        const completedLength = this.toNumber(download.completedLength);
        const downloadSpeed = this.toNumber(download.downloadSpeed);
        const primaryFile = Array.isArray(download.files) ? download.files[0] : null;
        const primaryUri = primaryFile && Array.isArray(primaryFile.uris) ? primaryFile.uris[0] : null;
        const fallbackName = `Download ${download.gid}`;
        const name = primaryFile && primaryFile.path
            ? path.basename(primaryFile.path)
            : this.getNameFromUri(primaryUri && primaryUri.uri, fallbackName);
        const progress = totalLength > 0 ? (completedLength / totalLength) * 100 : 0;
        const remainingBytes = Math.max(totalLength - completedLength, 0);
        const etaSeconds = downloadSpeed > 0 ? Math.ceil(remainingBytes / downloadSpeed) : null;

        return {
            gid: download.gid,
            status: download.status,
            name,
            source: primaryUri && primaryUri.uri ? primaryUri.uri : '',
            savePath: primaryFile && primaryFile.path ? primaryFile.path : '',
            totalLength,
            completedLength,
            progress: Number(progress.toFixed(1)),
            downloadSpeed,
            uploadSpeed: this.toNumber(download.uploadSpeed),
            connections: this.toNumber(download.connections),
            errorCode: download.errorCode || '',
            errorMessage: download.errorMessage || '',
            etaSeconds,
            dir: download.dir || this.config.DOWNLOAD_DIR,
            canPause: download.status === 'active' || download.status === 'waiting',
            canResume: download.status === 'paused',
            canRemove: download.status !== 'removed'
        };
    }

    summarize(downloads) {
        return downloads.reduce((summary, item) => {
            summary.total += 1;

            if (item.status === 'active') {
                summary.active += 1;
            } else if (item.status === 'waiting' || item.status === 'paused') {
                summary.queued += 1;
            } else if (item.status === 'complete') {
                summary.completed += 1;
            } else if (item.status === 'error') {
                summary.failed += 1;
            }

            summary.totalSpeed += item.downloadSpeed;
            return summary;
        }, {
            total: 0,
            active: 0,
            queued: 0,
            completed: 0,
            failed: 0,
            totalSpeed: 0
        });
    }

    rpcRequest(method, params = []) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params
            });

            const request = http.request({
                host: this.config.ARIA2_HOST,
                port: this.config.ARIA2_PORT,
                path: '/jsonrpc',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                },
                timeout: 2000
            }, (response) => {
                let body = '';

                response.on('data', (chunk) => {
                    body += chunk.toString();
                });

                response.on('end', () => {
                    try {
                        const parsed = JSON.parse(body || '{}');

                        if (parsed.error) {
                            reject(new Error(parsed.error.message || 'aria2 RPC error'));
                            return;
                        }

                        resolve(parsed.result);
                    } catch (error) {
                        reject(new Error(`Unable to parse aria2 response: ${error.message}`));
                    }
                });
            });

            request.on('timeout', () => {
                request.destroy(new Error('aria2 RPC request timed out'));
            });

            request.on('error', (error) => {
                reject(error);
            });

            request.write(payload);
            request.end();
        });
    }

    spawnAria2() {
        const args = [
            '--enable-rpc=true',
            '--rpc-listen-all=false',
            `--rpc-listen-port=${this.config.ARIA2_PORT}`,
            '--rpc-allow-origin-all=true',
            '--continue=true',
            '--seed-time=0',
            '--auto-file-renaming=false',
            '--summary-interval=0',
            `--max-concurrent-downloads=${this.config.MAX_CONCURRENT_DOWNLOADS}`,
            `--dir=${this.config.DOWNLOAD_DIR}`,
            `--input-file=${this.config.SESSION_FILE}`,
            `--save-session=${this.config.SESSION_FILE}`,
            '--save-session-interval=30'
        ];

        this.aria2Process = spawn('aria2c', args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        this.aria2Process.stdout.on('data', (data) => {
            const message = data.toString().trim();
            if (message) {
                console.log(`[aria2] ${message}`);
            }
        });

        this.aria2Process.stderr.on('data', (data) => {
            const message = data.toString().trim();
            if (message) {
                console.error(`[aria2] ${message}`);
            }
        });

        this.aria2Process.on('error', (error) => {
            this.aria2StartupError = `Unable to start aria2c. Install aria2 and ensure aria2c is available on PATH. ${error.message}`;
            this.aria2Ready = false;
            this.aria2Process = null;
            this.aria2StartingPromise = null;
        });

        this.aria2Process.on('exit', (code) => {
            this.aria2Ready = false;
            this.aria2Process = null;
            this.aria2StartingPromise = null;

            if (code !== 0) {
                this.aria2StartupError = `aria2c exited unexpectedly with code ${code}.`;
            }
        });
    }

    async ensureReady() {
        if (this.aria2Ready) {
            return;
        }

        if (this.aria2StartingPromise) {
            return this.aria2StartingPromise;
        }

        this.aria2StartupError = '';

        if (!this.aria2Process) {
            this.spawnAria2();
        }

        this.aria2StartingPromise = (async () => {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                if (this.aria2StartupError) {
                    throw new Error(this.aria2StartupError);
                }

                try {
                    await this.rpcRequest('aria2.getVersion');
                    this.aria2Ready = true;
                    return;
                } catch {
                    await this.delay(300);
                }
            }

            this.aria2StartupError = 'aria2 RPC did not become ready in time.';
            throw new Error(this.aria2StartupError);
        })();

        try {
            await this.aria2StartingPromise;
        } finally {
            this.aria2StartingPromise = null;
        }
    }

    async getDownloadsSnapshot() {
        await this.ensureReady();

        const [active, waiting, stopped, globalStat, version] = await Promise.all([
            this.rpcRequest('aria2.tellActive', [this.config.STATUS_KEYS]),
            this.rpcRequest('aria2.tellWaiting', [0, 50, this.config.STATUS_KEYS]),
            this.rpcRequest('aria2.tellStopped', [0, 50, this.config.STATUS_KEYS]),
            this.rpcRequest('aria2.getGlobalStat'),
            this.rpcRequest('aria2.getVersion')
        ]);

        const downloads = [...active, ...waiting, ...stopped].map((item) => this.formatDownload(item));

        return {
            connected: true,
            error: '',
            version: version && version.version ? version.version : '',
            config: {
                downloadDir: this.config.DOWNLOAD_DIR,
                maxConcurrentDownloads: this.config.MAX_CONCURRENT_DOWNLOADS,
                rpcPort: this.config.ARIA2_PORT
            },
            globalStat: {
                downloadSpeed: this.toNumber(globalStat.downloadSpeed),
                uploadSpeed: this.toNumber(globalStat.uploadSpeed),
                numActive: this.toNumber(globalStat.numActive),
                numStopped: this.toNumber(globalStat.numStopped),
                numWaiting: this.toNumber(globalStat.numWaiting)
            },
            stats: this.summarize(downloads),
            downloads
        };
    }

    getUnavailableSnapshot(error) {
        return {
            connected: false,
            error: (error && error.message) || this.aria2StartupError || 'aria2 is unavailable',
            version: '',
            config: {
                downloadDir: this.config.DOWNLOAD_DIR,
                maxConcurrentDownloads: this.config.MAX_CONCURRENT_DOWNLOADS,
                rpcPort: this.config.ARIA2_PORT
            },
            globalStat: {
                downloadSpeed: 0,
                uploadSpeed: 0,
                numActive: 0,
                numStopped: 0,
                numWaiting: 0
            },
            stats: {
                total: 0,
                active: 0,
                queued: 0,
                completed: 0,
                failed: 0,
                totalSpeed: 0
            },
            downloads: []
        };
    }

    validateSupportedUrl(rawUrl) {
        const parsedUrl = new URL(rawUrl);

        if (!['http:', 'https:', 'ftp:', 'magnet:'].includes(parsedUrl.protocol)) {
            throw new Error('Only http, https, ftp, and magnet URLs are supported.');
        }
    }

    async addDownload(rawUrl, rawSubfolder) {
        await this.ensureReady();
        const targetDir = this.resolveDownloadDir(rawSubfolder);
        const gid = await this.rpcRequest('aria2.addUri', [[rawUrl], { dir: targetDir }]);
        return { gid, dir: targetDir };
    }

    async getDownloadByGid(gid) {
        const download = await this.rpcRequest('aria2.tellStatus', [gid, this.config.STATUS_KEYS]);

        if (!download || !download.gid) {
            throw new Error('Download not found.');
        }

        return download;
    }

    async applyDownloadAction(gid, action) {
        const download = await this.getDownloadByGid(gid);

        if (action === 'pause') {
            if (!['active', 'waiting'].includes(download.status)) {
                throw new Error('Only active or queued downloads can be paused.');
            }

            await this.rpcRequest('aria2.pause', [gid]);
            return;
        }

        if (action === 'resume') {
            if (download.status !== 'paused') {
                throw new Error('Only paused downloads can be resumed.');
            }

            await this.rpcRequest('aria2.unpause', [gid]);
            return;
        }

        if (action === 'remove') {
            if (['complete', 'error', 'removed'].includes(download.status)) {
                await this.rpcRequest('aria2.removeDownloadResult', [gid]);
                return;
            }

            await this.rpcRequest('aria2.remove', [gid]);
            return;
        }

        throw new Error('Unsupported action.');
    }

    forceKillPid(pid) {
        return new Promise((resolve) => {
            if (!pid) {
                resolve();
                return;
            }

            if (process.platform === 'win32') {
                const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
                    stdio: 'ignore'
                });

                killer.on('error', () => resolve());
                killer.on('close', () => resolve());
                return;
            }

            try {
                process.kill(pid, 'SIGKILL');
            } catch {
                // Ignore when process already exited.
            }

            resolve();
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.aria2Process) {
                resolve();
                return;
            }

            const processRef = this.aria2Process;
            const pid = processRef.pid;
            let completed = false;

            const done = () => {
                if (completed) {
                    return;
                }

                completed = true;
                this.aria2Process = null;
                this.aria2Ready = false;
                resolve();
            };

            processRef.once('exit', done);

            try {
                processRef.kill('SIGTERM');
            } catch {
                done();
                return;
            }

            setTimeout(async () => {
                if (completed) {
                    return;
                }

                await this.forceKillPid(pid);
                done();
            }, 1500).unref();
        });
    }
}

module.exports = {
    Aria2Service
};
