const form = document.getElementById('download-form');
const input = document.getElementById('url-input');
const subfolderInput = document.getElementById('subfolder-input');
const maxConcurrencyHint = document.getElementById('max-concurrency-hint');
const SUPPORTED_SCHEMES = ['http:', 'https:', 'ftp:', 'magnet:'];

const submitButton = document.getElementById('submit-button');
const banner = document.getElementById('banner');
const downloadsRoot = document.getElementById('downloads');
const statsRoot = document.getElementById('stats');
const meta = document.getElementById('meta');
const refreshMeta = document.getElementById('refresh-meta');
const pendingActions = new Set();
let lastRefresh = null;

function formatBytes(value) {
    const numeric = Number(value || 0);
    if (!numeric) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const power = Math.min(Math.floor(Math.log(numeric) / Math.log(1024)), units.length - 1);
    const size = numeric / Math.pow(1024, power);
    const precision = size >= 100 || power === 0 ? 0 : 1;
    return size.toFixed(precision) + ' ' + units[power];
}

function formatSpeed(value) {
    return formatBytes(value) + '/s';
}

function formatEta(seconds) {
    if (!seconds || !Number.isFinite(seconds)) {
        return '-';
    }

    if (seconds < 60) {
        return seconds + 's';
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;

    if (minutes < 60) {
        return minutes + 'm ' + remainder + 's';
    }

    const hours = Math.floor(minutes / 60);
    return hours + 'h ' + (minutes % 60) + 'm';
}

function setBanner(message, tone) {
    banner.textContent = message || '';
    banner.className = 'banner' + (tone ? ' ' + tone : '');
}

function renderStats(stats) {
    statsRoot.innerHTML = [
        { label: 'Active', value: stats.active },
        { label: 'Queued', value: stats.queued },
        { label: 'Completed', value: stats.completed },
        { label: 'Failed', value: stats.failed }
    ].map(function(item) {
        return '<div class="stat"><span>' + item.label + '</span><strong>' + item.value + '</strong></div>';
    }).join('');
}

function renderDownloads(downloads) {
    if (!downloads.length) {
        downloadsRoot.innerHTML = '<div class="empty">No downloads in aria2 yet. Paste a URL above to create the first job.</div>';
        return;
    }

    downloadsRoot.innerHTML = downloads.map(function(item) {
        const details = item.errorMessage ? item.errorMessage : item.savePath;
        const buttons = [];

        if (item.canPause) {
            buttons.push('<button class="action-button secondary" data-action="pause" data-gid="' + escapeHtml(item.gid) + '"' + (pendingActions.has(item.gid + ':pause') ? ' disabled' : '') + '>Pause</button>');
        }

        if (item.canResume) {
            buttons.push('<button class="action-button secondary" data-action="resume" data-gid="' + escapeHtml(item.gid) + '"' + (pendingActions.has(item.gid + ':resume') ? ' disabled' : '') + '>Resume</button>');
        }

        if (item.canRemove) {
            buttons.push('<button class="action-button warn" data-action="remove" data-gid="' + escapeHtml(item.gid) + '"' + (pendingActions.has(item.gid + ':remove') ? ' disabled' : '') + '>Remove</button>');
        }

        return [
            '<article class="download-card">',
            '  <div class="download-top">',
            '    <div>',
            '      <h3 class="download-name">' + escapeHtml(item.name) + '</h3>',
            '      <p class="download-source">' + escapeHtml(item.source || details || 'Waiting for metadata') + '</p>',
            '    </div>',
            '    <span class="badge ' + escapeHtml(item.status) + '">' + escapeHtml(item.status) + '</span>',
            '  </div>',
            '  <div class="progress-track"><div class="progress-bar" style="width:' + Math.max(item.progress, 2) + '%"></div></div>',
            '  <div class="download-metrics">',
            '    <div class="metric"><span>Progress</span><strong>' + item.progress.toFixed(1) + '%</strong></div>',
            '    <div class="metric"><span>Transferred</span><strong>' + formatBytes(item.completedLength) + ' / ' + formatBytes(item.totalLength) + '</strong></div>',
            '    <div class="metric"><span>Speed</span><strong>' + formatSpeed(item.downloadSpeed) + '</strong></div>',
            '    <div class="metric"><span>ETA</span><strong>' + formatEta(item.etaSeconds) + '</strong></div>',
            '  </div>',
            '  <div class="download-actions">' + buttons.join('') + '</div>',
            '</article>'
        ].join('');
    }).join('');
}

async function runDownloadAction(gid, action) {
    const pendingKey = gid + ':' + action;
    pendingActions.add(pendingKey);
    setBanner('Applying ' + action + ' for ' + gid + '...', '');

    try {
        const response = await fetch('/api/downloads/' + encodeURIComponent(gid) + '/' + encodeURIComponent(action), {
            method: 'POST'
        });

        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to ' + action + ' download');
        }

        setBanner(payload.message || ('Download ' + action + 'd.'), 'success');
        await loadDownloads();
    } catch (error) {
        setBanner(error.message, 'error');
    } finally {
        pendingActions.delete(pendingKey);
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function loadDownloads() {
    try {
        const response = await fetch('/api/downloads');
        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to load downloads');
        }

        renderStats(payload.stats);
        renderDownloads(payload.downloads);
        maxConcurrencyHint.textContent = String(payload.config.maxConcurrentDownloads);
        meta.textContent = 'aria2 ' + payload.version + ' • saving to ' + payload.config.downloadDir + ' • ' + payload.config.maxConcurrentDownloads + ' concurrent downloads';
        lastRefresh = new Date();
        refreshMeta.textContent = 'Updated ' + lastRefresh.toLocaleTimeString();
    } catch (error) {
        renderStats({ active: 0, queued: 0, completed: 0, failed: 0 });
        downloadsRoot.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
        maxConcurrencyHint.textContent = 'configured';
        meta.textContent = 'aria2 unavailable';
        refreshMeta.textContent = 'Retrying...';
    }
}

form.addEventListener('submit', async function(event) {
    event.preventDefault();
    const url = input.value.trim();
    const subfolder = subfolderInput.value.trim();

    if (!url) {
        setBanner('Enter a valid URL.', 'error');
        return;
    }

    const hasSupportedScheme = SUPPORTED_SCHEMES.some(function(scheme) {
        return url.toLowerCase().startsWith(scheme);
    });

    if (!hasSupportedScheme) {
        setBanner('Use a supported URL scheme: http, https, ftp, or magnet.', 'error');
        return;
    }

    submitButton.disabled = true;
    setBanner('Queueing download...', '');

    try {
        const response = await fetch('/api/downloads', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                subfolder: subfolder
            })
        });

        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.error || 'Unable to add download');
        }

        input.value = '';
        setBanner('Download added to aria2 queue.', 'success');
        await loadDownloads();
    } catch (error) {
        setBanner(error.message, 'error');
    } finally {
        submitButton.disabled = false;
    }
});

downloadsRoot.addEventListener('click', function(event) {
    const button = event.target.closest('[data-action][data-gid]');

    if (!button) {
        return;
    }

    event.preventDefault();

    const gid = button.getAttribute('data-gid');
    const action = button.getAttribute('data-action');

    if (!gid || !action) {
        return;
    }

    runDownloadAction(gid, action);
});

loadDownloads();
setInterval(loadDownloads, 1500);
