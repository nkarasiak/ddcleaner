// ddcleaner — DaisyDisk-Inspired Frontend
(function() {
    'use strict';

    // --- State ---
    let currentPath = '';
    let rootPath = '';
    let scanComplete = false;
    let scanStartedAt = null;
    let eventSource = null;
    let treeCache = {};

    // Two-column browser state
    let leftColumnPath = '';
    let rightColumnPath = '';
    let leftColumnData = null;
    let rightColumnData = null;
    let selectedLeftIndex = -1;
    let selectedRightIndex = -1;
    let activeColumn = 'left'; // which column has focus

    // Selection state
    let selectedPaths = new Map(); // path -> {name, size, size_human, has_children}

    // Sunburst state
    let sunburstRings = []; // computed segments for hit detection
    let sunburstHovered = null;
    let sunburstCenterPath = '';

    // View mode
    let viewMode = 'folders'; // 'folders' | 'biggest'

    // Disk info
    let diskInfo = null;

    // --- DOM refs ---
    const $ = id => document.getElementById(id);
    const progressBar = $('progressBar');
    const statusInfo = $('statusInfo');
    const freshnessDot = $('freshnessDot');
    const freshnessText = $('freshnessText');
    const landing = $('landing');
    const appLayout = $('appLayout');
    const scanInput = $('scanInput');
    const scanBtn = $('scanBtn');
    const rescanBtn = $('rescanBtn');
    const breadcrumb = $('breadcrumb');
    const tooltip = $('tooltip');
    const tooltipName = $('tooltipName');
    const tooltipDetail = $('tooltipDetail');
    const shortcutsOverlay = $('shortcutsOverlay');
    const contextMenu = $('contextMenu');
    const smartOverlay = $('smartOverlay');
    const smartList = $('smartList');
    const smartTotal = $('smartTotal');
    const smartBtn = $('smartBtn');
    const smartClose = $('smartClose');
    const canvas = $('sunburstCanvas');
    const ctx = canvas.getContext('2d');
    const leftColBody = $('leftColBody');
    const rightColBody = $('rightColBody');
    const leftColHeader = $('leftColHeader');
    const rightColHeader = $('rightColHeader');
    const actionSize = $('actionSize');
    const actionCount = $('actionCount');
    const reviewBtn = $('reviewBtn');

    // --- Context menu state ---
    let ctxTarget = null;

    // --- Color helpers ---
    const SUNBURST_COLORS = ['#2dd4bf','#3fb950','#d4a017','#f0883e','#f85149','#4493f8','#a371f7','#6cb6ff'];

    function sizeColorClass(sizeHuman) {
        if (/[GT]iB/.test(sizeHuman)) return 'size-gb';
        if (/MiB/.test(sizeHuman)) return 'size-mb';
        if (/KiB/.test(sizeHuman)) return 'size-kb';
        return 'size-bytes';
    }

    function formatNum(n) {
        return n.toLocaleString();
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const val = bytes / Math.pow(1024, i);
        return val.toFixed(2) + ' ' + units[i];
    }

    function formatDate(timestamp) {
        if (!timestamp || timestamp === 0) return '';
        const d = new Date(timestamp * 1000);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    // --- Freshness ---
    function updateFreshness() {
        if (!scanStartedAt) return;
        if (!scanComplete) {
            freshnessDot.className = 'freshness-dot scanning';
            freshnessText.textContent = 'Scanning...';
            return;
        }
        const ago = (Date.now() - scanStartedAt) / 1000;
        let cls, text;
        if (ago < 60) {
            text = `${Math.round(ago)}s ago`;
            cls = 'fresh';
        } else if (ago < 300) {
            text = `${Math.round(ago / 60)}m ago`;
            cls = 'aging';
        } else {
            text = `${Math.round(ago / 60)}m ago`;
            cls = 'stale';
        }
        freshnessDot.className = 'freshness-dot ' + cls;
        freshnessText.textContent = text;
    }
    setInterval(updateFreshness, 1000);

    // --- SSE ---
    function connectSSE() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = function(e) {
            const data = JSON.parse(e.data);
            updateStatus(data);
            if (data.scan_complete && !scanComplete) {
                scanComplete = true;
                scanStartedAt = Date.now();
                loadLeftColumn(currentPath);
                fetchDiskInfo();
            }
        };
        eventSource.onerror = function() {
            setTimeout(connectSSE, 3000);
        };
    }

    function updateStatus(data) {
        statusInfo.textContent = `${data.total_size_human || '\u2014'} \u00b7 ${formatNum(data.files_scanned || 0)} files \u00b7 ${(data.elapsed_secs || 0).toFixed(1)}s`;
        const pct = data.scan_complete ? 100 : Math.min(95, Math.log10((data.files_scanned || 1) + 1) * 20);
        progressBar.style.width = pct + '%';
        progressBar.classList.toggle('complete', data.scan_complete);
        scanComplete = data.scan_complete;
    }

    // --- Disk info ---
    async function fetchDiskInfo() {
        try {
            const resp = await fetch('/api/diskinfo');
            if (!resp.ok) return;
            diskInfo = await resp.json();
            updateStorageDisplay();
        } catch (e) {}
    }

    function updateStorageDisplay() {
        if (!diskInfo) return;
        const fill = $('storageBarFill');
        const info = $('storageInfo');
        const infoText = $('storageInfoText');
        const name = $('storageName');

        const usedPct = Math.round((diskInfo.used / diskInfo.total) * 100);
        fill.style.width = usedPct + '%';
        info.textContent = `${diskInfo.available_human} available of ${diskInfo.total_human}`;
        infoText.textContent = `${diskInfo.available_human} available of ${diskInfo.total_human}`;
        name.textContent = rootPath.split('/').filter(Boolean)[0] || 'SSD';
    }

    // --- API ---
    async function startScan(path) {
        scanComplete = false;
        scanStartedAt = null;
        currentPath = path;
        rootPath = path;
        treeCache = {};
        selectedPaths.clear();
        updateActionBar();

        landing.style.display = 'none';
        appLayout.style.display = 'flex';

        try {
            const resp = await fetch('/api/scan?path=' + encodeURIComponent(path));
            if (resp.status === 409) { /* already scanning */ }
        } catch (e) {
            console.error('Scan start failed:', e);
        }

        connectSSE();
        updateSidebar();
        pollTree();
    }

    function pollTree() {
        if (scanComplete) return;
        setTimeout(async () => {
            await loadLeftColumn(currentPath);
            if (!scanComplete) pollTree();
        }, 800);
    }

    async function fetchTreeNode(path) {
        if (treeCache[path]) return treeCache[path];
        try {
            const url = '/api/tree?path=' + encodeURIComponent(path);
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const data = await resp.json();
            treeCache[data.path] = data;
            return data;
        } catch (e) {
            return null;
        }
    }

    // --- Navigation ---
    function navigateTo(path) {
        currentPath = path;
        selectedLeftIndex = -1;
        selectedRightIndex = -1;
        loadLeftColumn(path);
    }

    function navigateUp() {
        if (!currentPath || currentPath === rootPath) return;
        const parts = currentPath.replace(/\/$/, '').split('/');
        parts.pop();
        const parent = parts.join('/') || '/';
        navigateTo(parent);
    }

    // --- Two-column browser ---
    async function loadLeftColumn(path) {
        leftColumnPath = path;
        const data = await fetchTreeNode(path);
        if (!data) return;
        leftColumnData = data;
        currentPath = data.path;
        treeCache[data.path] = data;

        leftColHeader.textContent = data.name;
        renderBrowserColumn(leftColBody, data, 'left');
        renderBreadcrumb();

        // Auto-select first folder child for right column
        const firstFolder = data.children.find(c => c.has_children);
        if (firstFolder) {
            loadRightColumn(firstFolder.path);
            highlightActiveLeft(firstFolder.path);
        } else if (data.children.length > 0) {
            rightColHeader.textContent = '\u00a0';
            rightColBody.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">No subfolders</div>';
            rightColumnPath = '';
            rightColumnData = null;
        } else {
            rightColHeader.textContent = '\u00a0';
            rightColBody.innerHTML = '';
            rightColumnPath = '';
            rightColumnData = null;
        }

        // Sunburst
        sunburstCenterPath = data.path;
        drawSunburst(data);
    }

    async function loadRightColumn(path) {
        rightColumnPath = path;
        const data = await fetchTreeNode(path);
        if (!data) return;
        rightColumnData = data;
        treeCache[data.path] = data;

        rightColHeader.textContent = data.name;
        renderBrowserColumn(rightColBody, data, 'right');
    }

    function highlightActiveLeft(activePath) {
        leftColBody.querySelectorAll('.browser-row').forEach(row => {
            row.classList.toggle('active', row.dataset.path === activePath);
        });
    }

    function renderBrowserColumn(container, data, side) {
        container.innerHTML = '';
        if (!data || !data.children || data.children.length === 0) {
            container.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Empty</div>';
            return;
        }

        const sorted = [...data.children].sort((a, b) => b.size - a.size);

        // Separate: main items, small items (<1%), hidden items (dotfiles)
        const mainItems = [];
        const smallItems = [];
        const hiddenItems = [];

        sorted.forEach(child => {
            if (child.name.startsWith('.')) {
                hiddenItems.push(child);
            } else if (child.percent < 1) {
                smallItems.push(child);
            } else {
                mainItems.push(child);
            }
        });

        mainItems.forEach((child, i) => {
            container.appendChild(createBrowserRow(child, side, i));
        });

        if (smallItems.length > 0) {
            appendCollapsibleGroup(container, `Small items (${smallItems.length})`, smallItems, side, mainItems.length);
        }

        if (hiddenItems.length > 0) {
            appendCollapsibleGroup(container, `Hidden items (${hiddenItems.length})`, hiddenItems, side, mainItems.length + smallItems.length);
        }
    }

    function createBrowserRow(child, side, index) {
        const row = document.createElement('div');
        row.className = 'browser-row';
        row.dataset.path = child.path;
        row.dataset.side = side;
        row.dataset.index = index;

        // Checkbox
        const cb = document.createElement('div');
        cb.className = 'row-checkbox' + (selectedPaths.has(child.path) ? ' checked' : '');
        cb.textContent = selectedPaths.has(child.path) ? '\u2713' : '';
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSelection(child, cb);
        });

        // Icon
        const icon = document.createElement('span');
        icon.className = 'row-icon';
        icon.textContent = child.has_children ? '\uD83D\uDCC1' : '\uD83D\uDCC4';

        // Name
        const name = document.createElement('span');
        name.className = 'row-name';
        name.textContent = child.name;

        // Size
        const size = document.createElement('span');
        size.className = 'row-size ' + sizeColorClass(child.size_human);
        size.textContent = child.size_human;

        row.appendChild(cb);
        row.appendChild(icon);
        row.appendChild(name);
        row.appendChild(size);

        // Click behavior
        row.addEventListener('click', () => {
            if (child.has_children) {
                if (side === 'left') {
                    highlightActiveLeft(child.path);
                    loadRightColumn(child.path);
                    // Update sunburst to show this child
                    sunburstCenterPath = currentPath;
                } else {
                    // Drill deeper: right becomes left
                    navigateTo(child.path);
                }
            }
        });

        // Context menu
        row.addEventListener('contextmenu', (e) => {
            showContextMenu(e, {
                path: child.path,
                name: child.name,
                size_human: child.size_human,
                has_children: child.has_children
            });
        });

        return row;
    }

    function appendCollapsibleGroup(container, label, items, side, startIndex) {
        const toggle = document.createElement('div');
        toggle.className = 'browser-group-toggle';
        const chevron = document.createElement('span');
        chevron.className = 'group-chevron';
        chevron.textContent = '\u203A';
        const text = document.createElement('span');
        text.textContent = label;
        toggle.appendChild(chevron);
        toggle.appendChild(text);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'browser-group-items';
        items.forEach((child, i) => {
            groupDiv.appendChild(createBrowserRow(child, side, startIndex + i));
        });

        toggle.addEventListener('click', () => {
            chevron.classList.toggle('expanded');
            groupDiv.classList.toggle('open');
        });

        container.appendChild(toggle);
        container.appendChild(groupDiv);
    }

    // --- Selection ---
    function toggleSelection(child, cbEl) {
        if (selectedPaths.has(child.path)) {
            selectedPaths.delete(child.path);
            if (cbEl) {
                cbEl.classList.remove('checked');
                cbEl.textContent = '';
            }
        } else {
            selectedPaths.set(child.path, {
                name: child.name,
                size: child.size,
                size_human: child.size_human,
                has_children: child.has_children
            });
            if (cbEl) {
                cbEl.classList.add('checked');
                cbEl.textContent = '\u2713';
            }
        }
        updateActionBar();
    }

    function updateActionBar() {
        let totalSize = 0;
        selectedPaths.forEach(v => totalSize += v.size);
        actionSize.textContent = formatSize(totalSize) + ' selected';
        actionCount.textContent = selectedPaths.size + ' item' + (selectedPaths.size !== 1 ? 's' : '');
        reviewBtn.disabled = selectedPaths.size === 0;
    }

    // --- Breadcrumb ---
    function renderBreadcrumb() {
        breadcrumb.innerHTML = '';
        const fullPath = currentPath || rootPath;
        const parts = fullPath.split('/').filter(Boolean);
        let accumulated = '';

        const rootEl = document.createElement('span');
        rootEl.className = 'breadcrumb-item' + (parts.length === 0 ? ' active' : '');
        rootEl.textContent = '/';
        rootEl.onclick = () => navigateTo(rootPath);
        breadcrumb.appendChild(rootEl);

        parts.forEach((part, i) => {
            accumulated += '/' + part;
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.textContent = '\u203A';
            breadcrumb.appendChild(sep);

            const el = document.createElement('span');
            el.className = 'breadcrumb-item' + (i === parts.length - 1 ? ' active' : '');
            el.textContent = part;
            const path = accumulated;
            el.onclick = () => navigateTo(path);
            breadcrumb.appendChild(el);
        });
    }

    // --- Sidebar ---
    function updateSidebar() {
        // Username from path
        const parts = rootPath.split('/').filter(Boolean);
        let username = parts[parts.length - 1] || 'User';
        if (parts[0] === 'home' && parts.length >= 2) username = parts[1];
        $('sidebarUserName').textContent = username;

        // Folder shortcuts
        const folders = $('sidebarFolders');
        folders.innerHTML = '';
        const wellKnown = [
            { name: 'Desktop', icon: '\uD83D\uDDA5\uFE0F' },
            { name: 'Documents', icon: '\uD83D\uDCC4' },
            { name: 'Downloads', icon: '\u2B07\uFE0F' },
            { name: 'Pictures', icon: '\uD83D\uDDBC\uFE0F' },
            { name: 'Music', icon: '\uD83C\uDFB5' },
            { name: 'Videos', icon: '\uD83C\uDFA5' },
        ];

        // Check if root tree data is cached
        const rootData = treeCache[rootPath];
        if (rootData) {
            const childNames = new Set(rootData.children.map(c => c.name));
            wellKnown.forEach(wk => {
                if (childNames.has(wk.name)) {
                    const child = rootData.children.find(c => c.name === wk.name);
                    const item = document.createElement('div');
                    item.className = 'sidebar-folder-item';
                    item.innerHTML = `<span class="folder-icon">${wk.icon}</span><span>${wk.name}</span><span class="folder-size">${child.size_human}</span>`;
                    item.addEventListener('click', () => navigateTo(child.path));
                    folders.appendChild(item);
                }
            });
        }
    }

    // Choose folder button
    $('sidebarChoose').addEventListener('click', () => {
        landing.style.display = 'flex';
        appLayout.style.display = 'none';
        scanInput.focus();
    });

    // --- Sunburst Chart ---
    function drawSunburst(rootData) {
        if (!rootData || !rootData.children || rootData.children.length === 0) {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = rect.width + 'px';
            canvas.style.height = rect.height + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, rect.width, rect.height);
            sunburstRings = [];
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const maxRadius = Math.min(cx, cy) - 20;
        const innerRadius = 55;
        const depth = 3;
        const ringWidth = (maxRadius - innerRadius) / depth;

        sunburstRings = [];

        // Draw ring levels
        const totalSize = rootData.size || 1;
        let startAngle = -Math.PI / 2;

        // Level 0: direct children
        const level0 = rootData.children.filter(c => c.size > 0).sort((a, b) => b.size - a.size);
        level0.forEach((child, i) => {
            const sweep = (child.size / totalSize) * Math.PI * 2;
            if (sweep < 0.005) { startAngle += sweep; return; }

            const color = SUNBURST_COLORS[i % SUNBURST_COLORS.length];
            const r0 = innerRadius;
            const r1 = innerRadius + ringWidth;

            drawArc(cx, cy, r0, r1, startAngle, startAngle + sweep, color, 0.9);
            sunburstRings.push({
                cx, cy, r0, r1,
                startAngle, endAngle: startAngle + sweep,
                data: child, level: 0, color
            });

            // Level 1: grandchildren (if cached)
            const childData = treeCache[child.path];
            if (childData && childData.children) {
                let subStart = startAngle;
                const childTotal = child.size || 1;
                const subChildren = childData.children.filter(c => c.size > 0).sort((a, b) => b.size - a.size);
                subChildren.forEach((gc, gi) => {
                    const subSweep = (gc.size / totalSize) * Math.PI * 2;
                    if (subSweep < 0.005) { subStart += subSweep; return; }

                    const subColor = adjustBrightness(color, gi % 2 === 0 ? -15 : 15);
                    const sr0 = innerRadius + ringWidth;
                    const sr1 = innerRadius + ringWidth * 2;

                    drawArc(cx, cy, sr0, sr1, subStart, subStart + subSweep, subColor, 0.85);
                    sunburstRings.push({
                        cx, cy, r0: sr0, r1: sr1,
                        startAngle: subStart, endAngle: subStart + subSweep,
                        data: gc, level: 1, color: subColor
                    });

                    // Level 2: great-grandchildren
                    const gcData = treeCache[gc.path];
                    if (gcData && gcData.children) {
                        let ggStart = subStart;
                        const ggChildren = gcData.children.filter(c => c.size > 0).sort((a, b) => b.size - a.size);
                        ggChildren.forEach((ggc, ggi) => {
                            const ggSweep = (ggc.size / totalSize) * Math.PI * 2;
                            if (ggSweep < 0.005) { ggStart += ggSweep; return; }

                            const ggColor = adjustBrightness(subColor, ggi % 2 === 0 ? -10 : 10);
                            const gr0 = innerRadius + ringWidth * 2;
                            const gr1 = innerRadius + ringWidth * 3;

                            drawArc(cx, cy, gr0, gr1, ggStart, ggStart + ggSweep, ggColor, 0.8);
                            sunburstRings.push({
                                cx, cy, r0: gr0, r1: gr1,
                                startAngle: ggStart, endAngle: ggStart + ggSweep,
                                data: ggc, level: 2, color: ggColor
                            });

                            ggStart += ggSweep;
                        });
                    }

                    subStart += subSweep;
                });
            }

            startAngle += sweep;
        });

        // Center circle
        ctx.beginPath();
        ctx.arc(cx, cy, innerRadius - 2, 0, Math.PI * 2);
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-surface').trim() || '#161b22';
        ctx.fill();

        // Center label
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#e6edf3';
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let centerLabel = rootData.name;
        if (ctx.measureText(centerLabel).width > innerRadius * 1.6) {
            centerLabel = centerLabel.slice(0, 8) + '\u2026';
        }
        ctx.fillText(centerLabel, cx, cy - 8);
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#8b949e';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText(rootData.size_human, cx, cy + 8);

        // Progressively fetch deeper levels
        fetchSunburstLevels(rootData);
    }

    async function fetchSunburstLevels(rootData) {
        if (!rootData || !rootData.children) return;
        const totalSize = rootData.size || 1;

        // Fetch level 1 (grandchildren) for items > 2%
        const toFetch1 = rootData.children.filter(c => c.has_children && (c.size / totalSize) > 0.02 && !treeCache[c.path]);
        const fetched1 = await Promise.all(toFetch1.map(c => fetchTreeNode(c.path)));
        if (fetched1.some(d => d)) {
            drawSunburst(rootData); // Redraw with new data
        }

        // Fetch level 2 (great-grandchildren) for items > 2%
        const toFetch2 = [];
        rootData.children.forEach(c => {
            const cData = treeCache[c.path];
            if (cData && cData.children) {
                cData.children.forEach(gc => {
                    if (gc.has_children && (gc.size / totalSize) > 0.02 && !treeCache[gc.path]) {
                        toFetch2.push(gc);
                    }
                });
            }
        });
        const fetched2 = await Promise.all(toFetch2.map(c => fetchTreeNode(c.path)));
        if (fetched2.some(d => d)) {
            drawSunburst(rootData); // Redraw with new data
        }
    }

    function drawArc(cx, cy, r0, r1, start, end, color, alpha) {
        ctx.beginPath();
        ctx.arc(cx, cy, r1, start, end);
        ctx.arc(cx, cy, r0, end, start, true);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fill();

        // Thin border
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--bg-root').trim() || '#0d1117';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.globalAlpha = 1;
    }

    function adjustBrightness(hex, amount) {
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        r = Math.max(0, Math.min(255, r + amount));
        g = Math.max(0, Math.min(255, g + amount));
        b = Math.max(0, Math.min(255, b + amount));
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    // Sunburst hit detection
    function sunburstHitTest(x, y) {
        if (sunburstRings.length === 0) return null;
        const ring0 = sunburstRings[0];
        const cx = ring0.cx, cy = ring0.cy;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let angle = Math.atan2(dy, dx);

        for (const seg of sunburstRings) {
            if (dist >= seg.r0 && dist <= seg.r1) {
                // Normalize angle to match segment range
                let a = angle;
                let s = seg.startAngle;
                let e = seg.endAngle;
                // Normalize to same range
                while (a < s) a += Math.PI * 2;
                while (a > s + Math.PI * 2) a -= Math.PI * 2;
                if (a >= s && a <= e) return seg;
            }
        }

        // Check center circle
        if (dist < 55) {
            return { isCenter: true };
        }

        return null;
    }

    // Canvas events
    canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const hit = sunburstHitTest(x, y);

        if (hit && !hit.isCenter && hit.data) {
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY + 12) + 'px';
            tooltipName.textContent = hit.data.name;
            let detail = hit.data.size_human + ' \u00b7 ' + hit.data.percent.toFixed(1) + '%';
            if (hit.data.newest_mtime) {
                detail += '<br>Modified: ' + formatDate(hit.data.newest_mtime);
            }
            detail += '<br>' + formatNum(hit.data.file_count) + ' files \u00b7 ' + formatNum(hit.data.dir_count) + ' dirs';
            tooltipDetail.innerHTML = detail;
            canvas.style.cursor = hit.data.has_children ? 'pointer' : 'default';

            // Highlight: redraw with brightness
            if (sunburstHovered !== hit) {
                sunburstHovered = hit;
                redrawSunburstHighlight();
            }
        } else if (hit && hit.isCenter) {
            tooltip.style.display = 'none';
            canvas.style.cursor = 'pointer';
            sunburstHovered = null;
        } else {
            tooltip.style.display = 'none';
            canvas.style.cursor = 'default';
            if (sunburstHovered) {
                sunburstHovered = null;
                redrawSunburstHighlight();
            }
        }
    });

    canvas.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        sunburstHovered = null;
        if (leftColumnData) drawSunburst(leftColumnData);
    });

    canvas.addEventListener('click', e => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = sunburstHitTest(x, y);

        if (hit) {
            if (hit.isCenter) {
                navigateUp();
            } else if (hit.data && hit.data.has_children) {
                navigateTo(hit.data.path);
            }
        }
    });

    function redrawSunburstHighlight() {
        if (!leftColumnData) return;
        drawSunburst(leftColumnData);
        if (!sunburstHovered || !sunburstHovered.data) return;

        // Draw highlight on hovered segment
        const seg = sunburstHovered;
        ctx.beginPath();
        ctx.arc(seg.cx, seg.cy, seg.r1 + 2, seg.startAngle, seg.endAngle);
        ctx.arc(seg.cx, seg.cy, seg.r0 - 1, seg.endAngle, seg.startAngle, true);
        ctx.closePath();
        ctx.fillStyle = adjustBrightness(seg.color, 40);
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Resize
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (leftColumnData) drawSunburst(leftColumnData);
        }, 100);
    });

    // --- View toggle ---
    $('viewFolders').addEventListener('click', () => setViewMode('folders'));
    $('viewBiggest').addEventListener('click', () => setViewMode('biggest'));

    function setViewMode(mode) {
        viewMode = mode;
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === mode);
        });
        document.body.classList.toggle('view-biggest', mode === 'biggest');

        if (mode === 'biggest') {
            loadBiggestFiles();
        } else {
            loadLeftColumn(currentPath);
        }
    }

    async function loadBiggestFiles() {
        // Flatten all cached entries, collect leaf nodes, sort by size
        leftColHeader.textContent = 'Biggest Files';
        rightColHeader.textContent = '\u00a0';
        rightColBody.innerHTML = '';

        const files = [];
        for (const path in treeCache) {
            const data = treeCache[path];
            if (!data || !data.children) continue;
            data.children.forEach(child => {
                if (!child.has_children) {
                    files.push(child);
                }
            });
        }

        // Dedupe by path
        const seen = new Set();
        const unique = [];
        files.sort((a, b) => b.size - a.size);
        files.forEach(f => {
            if (!seen.has(f.path)) {
                seen.add(f.path);
                unique.push(f);
            }
        });

        leftColBody.innerHTML = '';
        unique.slice(0, 200).forEach((child, i) => {
            leftColBody.appendChild(createBrowserRow(child, 'left', i));
        });

        if (unique.length === 0) {
            leftColBody.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Scan more folders to populate this view</div>';
        }
    }

    // --- Context menu ---
    function showContextMenu(e, data) {
        e.preventDefault();
        ctxTarget = data;
        contextMenu.style.display = 'block';
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) contextMenu.style.left = (e.clientX - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) contextMenu.style.top = (e.clientY - rect.height) + 'px';
    }

    function hideContextMenu() {
        contextMenu.style.display = 'none';
        ctxTarget = null;
    }

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.browser-row') && !e.target.closest('.smart-item')) {
            hideContextMenu();
        }
    });

    $('ctxCopyPath').addEventListener('click', () => {
        if (ctxTarget) navigator.clipboard.writeText(ctxTarget.path).catch(() => {});
    });

    $('ctxOpenExplorer').addEventListener('click', () => {
        if (ctxTarget) fetch('/api/open?path=' + encodeURIComponent(ctxTarget.path));
    });

    $('ctxDelete').addEventListener('click', () => {
        if (ctxTarget) confirmDelete(ctxTarget.path, ctxTarget.name, ctxTarget.size_human);
    });

    // --- Smart cleanup ---
    async function openSmart() {
        smartOverlay.classList.add('open');
        smartList.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Analyzing...</div>';
        try {
            const resp = await fetch('/api/smart');
            if (!resp.ok) return;
            const data = await resp.json();
            smartTotal.textContent = data.total_size_human + ' recoverable';
            smartList.innerHTML = '';
            if (data.items.length === 0) {
                smartList.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No cleanup suggestions</div>';
                return;
            }
            data.items.forEach(item => {
                const el = document.createElement('div');
                el.className = 'smart-item';
                const badge = document.createElement('span');
                badge.className = 'smart-badge ' + item.category;
                badge.textContent = item.category;
                const info = document.createElement('div');
                info.className = 'smart-info';
                info.innerHTML = `<div class="smart-name">${escHtml(item.name)}</div><div class="smart-path">${escHtml(item.path)}</div><div class="smart-desc">${escHtml(item.description)} \u00b7 ${formatNum(item.file_count)} files</div>`;
                const size = document.createElement('span');
                size.className = 'smart-size';
                size.textContent = item.size_human;
                el.appendChild(badge);
                el.appendChild(info);
                el.appendChild(size);
                el.addEventListener('click', () => { smartOverlay.classList.remove('open'); navigateTo(item.path); });
                el.addEventListener('contextmenu', (e) => showContextMenu(e, { path: item.path, name: item.name, size_human: item.size_human, has_children: true }));
                smartList.appendChild(el);
            });
        } catch (e) {
            smartList.innerHTML = '<div style="padding:20px;color:var(--accent-red)">Failed to load</div>';
        }
    }

    smartBtn.addEventListener('click', openSmart);
    smartClose.addEventListener('click', () => smartOverlay.classList.remove('open'));
    smartOverlay.addEventListener('click', e => { if (e.target === smartOverlay) smartOverlay.classList.remove('open'); });

    // --- Search ---
    const searchOverlay = $('searchOverlay');
    const searchInput2 = $('searchInput');
    const searchResults = $('searchResults');
    let searchDebounce = null;

    function openSearch() {
        searchOverlay.classList.add('open');
        searchInput2.value = '';
        searchResults.innerHTML = '<div class="search-empty">Type to search files and folders</div>';
        setTimeout(() => searchInput2.focus(), 50);
    }

    function closeSearch() { searchOverlay.classList.remove('open'); }

    searchInput2.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        const q = searchInput2.value.trim();
        if (q.length < 2) {
            searchResults.innerHTML = '<div class="search-empty">Type at least 2 characters</div>';
            return;
        }
        searchDebounce = setTimeout(async () => {
            try {
                const resp = await fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=30');
                if (!resp.ok) return;
                const results = await resp.json();
                searchResults.innerHTML = '';
                if (results.length === 0) {
                    searchResults.innerHTML = '<div class="search-empty">No results</div>';
                    return;
                }
                results.forEach(item => {
                    const el = document.createElement('div');
                    el.className = 'search-item';
                    el.innerHTML = `<span class="search-item-icon">${item.has_children ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span><div class="search-item-info"><div class="search-item-name">${escHtml(item.name)}</div><div class="search-item-path">${escHtml(item.path)}</div></div><span class="search-item-size">${item.size_human}</span>`;
                    el.addEventListener('click', () => {
                        closeSearch();
                        if (item.has_children) navigateTo(item.path);
                        else { const parts = item.path.split('/'); parts.pop(); navigateTo(parts.join('/') || '/'); }
                    });
                    searchResults.appendChild(el);
                });
            } catch (e) {}
        }, 200);
    });

    searchOverlay.addEventListener('click', e => { if (e.target === searchOverlay) closeSearch(); });
    $('searchBtn').addEventListener('click', openSearch);

    // --- File types ---
    const typesOverlay = $('typesOverlay');
    const typesList = $('typesList');

    async function openTypes() {
        typesOverlay.classList.add('open');
        typesList.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Loading...</div>';
        try {
            const resp = await fetch('/api/types');
            if (!resp.ok) return;
            const data = await resp.json();
            typesList.innerHTML = '';
            const maxSize = data.types.length > 0 ? data.types[0].size : 1;
            data.types.slice(0, 50).forEach(t => {
                const el = document.createElement('div');
                el.className = 'type-item';
                el.innerHTML = `<span class="type-ext">.${escHtml(t.extension)}</span><div class="type-bar-wrap"><div class="type-bar" style="width:${Math.max(1, (t.size / maxSize) * 100)}%"></div></div><span class="type-meta">${t.size_human}<br><span class="type-count">${formatNum(t.count)} files</span></span>`;
                typesList.appendChild(el);
            });
        } catch (e) {
            typesList.innerHTML = '<div style="padding:20px;color:var(--accent-red)">Failed to load</div>';
        }
    }

    $('typesBtn').addEventListener('click', openTypes);
    $('typesClose').addEventListener('click', () => typesOverlay.classList.remove('open'));
    typesOverlay.addEventListener('click', e => { if (e.target === typesOverlay) typesOverlay.classList.remove('open'); });

    // --- Delete ---
    const deleteOverlay = $('deleteOverlay');
    let pendingDeletePath = null;

    function confirmDelete(path, name, sizeHuman) {
        pendingDeletePath = path;
        $('deleteMsg').textContent = `${name} (${sizeHuman})\n${path}`;
        deleteOverlay.classList.add('open');
    }

    $('deleteCancel').addEventListener('click', () => { deleteOverlay.classList.remove('open'); pendingDeletePath = null; });

    $('deleteConfirm').addEventListener('click', async () => {
        if (!pendingDeletePath) return;
        const btn = $('deleteConfirm');
        btn.textContent = 'Deleting...';
        btn.disabled = true;
        try {
            const resp = await fetch('/api/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: pendingDeletePath })
            });
            const result = await resp.json();
            if (result.success) {
                deleteOverlay.classList.remove('open');
                // Remove from selection if selected
                selectedPaths.delete(pendingDeletePath);
                updateActionBar();
                // Invalidate cache
                delete treeCache[currentPath];
                loadLeftColumn(currentPath);
            } else {
                alert('Delete failed: ' + result.message);
            }
        } catch (e) {
            alert('Delete failed: ' + e.message);
        }
        btn.textContent = 'Delete permanently';
        btn.disabled = false;
        pendingDeletePath = null;
    });

    deleteOverlay.addEventListener('click', e => { if (e.target === deleteOverlay) { deleteOverlay.classList.remove('open'); pendingDeletePath = null; } });

    // --- Review to Remove ---
    reviewBtn.addEventListener('click', openReview);

    function openReview() {
        if (selectedPaths.size === 0) return;
        const overlay = $('reviewOverlay');
        const list = $('reviewList');
        const total = $('reviewTotal');

        let totalSize = 0;
        selectedPaths.forEach(v => totalSize += v.size);
        total.textContent = formatSize(totalSize);

        list.innerHTML = '';
        selectedPaths.forEach((info, path) => {
            const el = document.createElement('div');
            el.className = 'review-item';
            el.innerHTML = `<div class="review-info"><div class="review-name">${escHtml(info.name)}</div><div class="review-path">${escHtml(path)}</div></div><span class="review-size">${info.size_human}</span>`;
            const uncheckBtn = document.createElement('button');
            uncheckBtn.className = 'review-uncheck';
            uncheckBtn.textContent = 'Remove';
            uncheckBtn.addEventListener('click', () => {
                selectedPaths.delete(path);
                updateActionBar();
                el.remove();
                // Update total
                let newTotal = 0;
                selectedPaths.forEach(v => newTotal += v.size);
                total.textContent = formatSize(newTotal);
                if (selectedPaths.size === 0) overlay.classList.remove('open');
                // Update checkboxes in browser
                refreshCheckboxes();
            });
            el.appendChild(uncheckBtn);
            list.appendChild(el);
        });

        overlay.classList.add('open');
    }

    $('reviewClose').addEventListener('click', () => $('reviewOverlay').classList.remove('open'));
    $('reviewOverlay').addEventListener('click', e => { if (e.target === $('reviewOverlay')) $('reviewOverlay').classList.remove('open'); });

    $('reviewDeleteAll').addEventListener('click', async () => {
        const btn = $('reviewDeleteAll');
        btn.textContent = 'Deleting...';
        btn.disabled = true;

        const paths = [...selectedPaths.keys()];
        for (const path of paths) {
            try {
                const resp = await fetch('/api/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });
                const result = await resp.json();
                if (result.success) {
                    selectedPaths.delete(path);
                }
            } catch (e) {}
        }

        btn.textContent = 'Delete All Selected';
        btn.disabled = false;
        updateActionBar();
        $('reviewOverlay').classList.remove('open');

        // Refresh view
        delete treeCache[currentPath];
        loadLeftColumn(currentPath);
    });

    function refreshCheckboxes() {
        document.querySelectorAll('.row-checkbox').forEach(cb => {
            const row = cb.closest('.browser-row');
            if (row) {
                const path = row.dataset.path;
                cb.classList.toggle('checked', selectedPaths.has(path));
                cb.textContent = selectedPaths.has(path) ? '\u2713' : '';
            }
        });
    }

    // --- Theme toggle ---
    const themeToggle = $('themeToggle');
    const themeIcon = $('themeIcon');
    let isDark = localStorage.getItem('ddcleaner-theme') !== 'light';

    function applyTheme() {
        document.body.classList.toggle('light', !isDark);
        themeIcon.textContent = isDark ? '\u263E' : '\u2600';
        localStorage.setItem('ddcleaner-theme', isDark ? 'dark' : 'light');
    }

    if (!localStorage.getItem('ddcleaner-theme')) {
        isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
    }
    applyTheme();

    themeToggle.addEventListener('click', () => {
        isDark = !isDark;
        applyTheme();
        if (leftColumnData) requestAnimationFrame(() => drawSunburst(leftColumnData));
    });

    // --- Keyboard ---
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); return; }

        if (e.key === 'Escape') {
            if (searchOverlay.classList.contains('open')) { closeSearch(); return; }
            if (deleteOverlay.classList.contains('open')) { deleteOverlay.classList.remove('open'); return; }
            if (typesOverlay.classList.contains('open')) { typesOverlay.classList.remove('open'); return; }
            if (smartOverlay.classList.contains('open')) { smartOverlay.classList.remove('open'); return; }
            if ($('reviewOverlay').classList.contains('open')) { $('reviewOverlay').classList.remove('open'); return; }
            if (shortcutsOverlay.classList.contains('open')) { shortcutsOverlay.classList.remove('open'); return; }
            navigateUp();
            return;
        }

        if (e.key === '?') { shortcutsOverlay.classList.toggle('open'); return; }

        if (e.target.tagName === 'INPUT') return;

        if (e.key === 'Backspace') { navigateUp(); e.preventDefault(); return; }
        if (e.key === 'r' || e.key === 'R') { rescan(); return; }
        if (e.key === 's' || e.key === 'S') { openSmart(); return; }
        if (e.key === 'f' || e.key === 'F') { openTypes(); return; }
        if (e.key === 't' || e.key === 'T') {
            isDark = !isDark; applyTheme();
            if (leftColumnData) requestAnimationFrame(() => drawSunburst(leftColumnData));
            return;
        }

        // Arrow keys for browser navigation
        const data = activeColumn === 'left' ? leftColumnData : rightColumnData;
        const idx = activeColumn === 'left' ? selectedLeftIndex : selectedRightIndex;
        const body = activeColumn === 'left' ? leftColBody : rightColBody;

        if (!data || !data.children) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const newIdx = Math.min(idx + 1, data.children.length - 1);
            if (activeColumn === 'left') selectedLeftIndex = newIdx;
            else selectedRightIndex = newIdx;
            highlightBrowserRow(body, newIdx);
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const newIdx = Math.max(idx - 1, 0);
            if (activeColumn === 'left') selectedLeftIndex = newIdx;
            else selectedRightIndex = newIdx;
            highlightBrowserRow(body, newIdx);
        }

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (activeColumn === 'left' && rightColumnData) {
                activeColumn = 'right';
                selectedRightIndex = 0;
                highlightBrowserRow(rightColBody, 0);
            }
        }

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (activeColumn === 'right') {
                activeColumn = 'left';
                highlightBrowserRow(leftColBody, selectedLeftIndex);
            }
        }

        if (e.key === 'Enter') {
            const curIdx = activeColumn === 'left' ? selectedLeftIndex : selectedRightIndex;
            const curData = activeColumn === 'left' ? leftColumnData : rightColumnData;
            if (curData && curIdx >= 0 && curIdx < curData.children.length) {
                const child = curData.children[curIdx];
                if (child.has_children) {
                    if (activeColumn === 'left') {
                        highlightActiveLeft(child.path);
                        loadRightColumn(child.path);
                    } else {
                        navigateTo(child.path);
                    }
                }
            }
        }

        if (e.key === ' ') {
            e.preventDefault();
            const curIdx = activeColumn === 'left' ? selectedLeftIndex : selectedRightIndex;
            const curData = activeColumn === 'left' ? leftColumnData : rightColumnData;
            if (curData && curIdx >= 0 && curIdx < curData.children.length) {
                const child = curData.children[curIdx];
                const rows = (activeColumn === 'left' ? leftColBody : rightColBody).querySelectorAll('.browser-row');
                const row = rows[curIdx];
                if (row) {
                    const cb = row.querySelector('.row-checkbox');
                    toggleSelection(child, cb);
                }
            }
        }
    });

    function highlightBrowserRow(container, index) {
        const rows = container.querySelectorAll('.browser-row');
        rows.forEach((row, i) => row.classList.toggle('selected', i === index));
        if (rows[index]) rows[index].scrollIntoView({ block: 'nearest' });
    }

    // --- Rescan ---
    function rescan() {
        if (!rootPath) return;
        startScan(rootPath);
    }

    rescanBtn.addEventListener('click', rescan);

    // --- Scan form ---
    scanBtn.onclick = () => {
        const path = scanInput.value.trim();
        if (path) startScan(path);
    };

    scanInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const path = scanInput.value.trim();
            if (path) startScan(path);
        }
    });

    $('shortcutHint').addEventListener('click', () => shortcutsOverlay.classList.toggle('open'));
    shortcutsOverlay.addEventListener('click', e => { if (e.target === shortcutsOverlay) shortcutsOverlay.classList.remove('open'); });

    // --- HTML escape ---
    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Auto-start ---
    async function init() {
        try {
            const resp = await fetch('/api/status');
            if (resp.ok) {
                const data = await resp.json();
                if (data.root_path && data.root_path !== '.' && data.files_scanned > 0) {
                    rootPath = data.root_path;
                    currentPath = data.root_path;
                    scanComplete = data.scan_complete;
                    if (scanComplete) scanStartedAt = Date.now();

                    landing.style.display = 'none';
                    appLayout.style.display = 'flex';

                    updateStatus(data);
                    connectSSE();
                    loadLeftColumn(currentPath);
                    fetchDiskInfo();
                    updateSidebar();

                    // After left column loads, update sidebar with folder shortcuts
                    setTimeout(() => updateSidebar(), 1500);
                    return;
                }
            }
        } catch (e) {}
        landing.style.display = 'flex';
    }

    init();
})();
