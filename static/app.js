// ddcleaner — Redesigned UI
(function() {
    'use strict';

    // --- State ---
    const state = {
        phase: 'landing',       // 'landing' | 'scanning' | 'ready'
        rootPath: '',
        currentPath: '',
        scanComplete: false,
        scanStartedAt: null,
        activeTab: 'explore',   // 'explore' | 'biggest' | 'cleanup' | 'types'
        treeCache: {},
        currentData: null,
        diskInfo: null,
        cleanupData: null,
        typesData: null,
        selected: new Map(),    // path -> {name, size, size_human, has_children}
        sunburstRings: [],
        sunburstHovered: null,
        sunburstCenterPath: '',
        sunburstRAF: null,
        isDark: true,
        selectedIndex: -1,
        eventSource: null,
        cleanupFilter: 'all',
    };

    // --- Event bus ---
    const bus = {
        _l: {},
        on(e, f) { (this._l[e] || (this._l[e] = [])).push(f); },
        emit(e, d) { (this._l[e] || []).forEach(f => f(d)); }
    };

    // --- SVG Icons (Lucide-style) ---
    const ICONS = {
        folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
        file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
        search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
        zap: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
        grid: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
        refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
        moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
        sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
        check: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        chevronRight: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
        compass: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
        barChart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
        hardDrive: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>',
    };

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
    const breadcrumb = $('breadcrumb');
    const tooltip = $('tooltip');
    const tooltipName = $('tooltipName');
    const tooltipDetail = $('tooltipDetail');
    const contextMenu = $('contextMenu');
    const canvas = $('sunburstCanvas');
    const ctx = canvas.getContext('2d');
    const browserList = $('browserList');
    const selectionTray = $('selectionTray');

    // --- Inject icons ---
    $('searchBtnIcon').innerHTML = ICONS.search;
    $('rescanBtnIcon').innerHTML = ICONS.refresh;
    $('landingIcon').innerHTML = ICONS.hardDrive;
    $('tabExploreIcon').innerHTML = ICONS.compass;
    $('tabBiggestIcon').innerHTML = ICONS.barChart;
    $('tabCleanupIcon').innerHTML = ICONS.zap;
    $('tabTypesIcon').innerHTML = ICONS.grid;

    // --- Context menu state ---
    let ctxTarget = null;

    // --- Color helpers ---
    const SUNBURST_COLORS = [
        '#5E6AD2', // indigo
        '#30D1A4', // teal
        '#E8772E', // orange
        '#E5484D', // red
        '#8B5CF6', // violet
        '#3B82F6', // blue
        '#F59E0B', // amber
        '#EC4899', // pink
        '#06B6D4', // cyan
        '#84CC16', // lime
    ];

    function sizeColorClass(sizeHuman) {
        if (/[GT]iB/.test(sizeHuman)) return 'size-gb';
        if (/MiB/.test(sizeHuman)) return 'size-mb';
        if (/KiB/.test(sizeHuman)) return 'size-kb';
        return 'size-bytes';
    }

    function formatNum(n) { return n.toLocaleString(); }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
    }

    function formatDate(timestamp) {
        if (!timestamp || timestamp === 0) return '';
        return new Date(timestamp * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Freshness ---
    function updateFreshness() {
        if (!state.scanStartedAt) return;
        if (!state.scanComplete) {
            freshnessDot.className = 'freshness-dot scanning';
            freshnessText.textContent = 'Scanning...';
            return;
        }
        const ago = (Date.now() - state.scanStartedAt) / 1000;
        let cls, text;
        if (ago < 60) { text = `${Math.round(ago)}s ago`; cls = 'fresh'; }
        else if (ago < 300) { text = `${Math.round(ago / 60)}m ago`; cls = 'aging'; }
        else { text = `${Math.round(ago / 60)}m ago`; cls = 'stale'; }
        freshnessDot.className = 'freshness-dot ' + cls;
        freshnessText.textContent = text;
    }
    setInterval(updateFreshness, 1000);

    // --- SSE ---
    function connectSSE() {
        if (state.eventSource) state.eventSource.close();
        state.eventSource = new EventSource('/api/events');
        state.eventSource.onmessage = function(e) {
            const data = JSON.parse(e.data);
            updateStatus(data);
            if (data.scan_complete && !state.scanComplete) {
                state.scanComplete = true;
                state.scanStartedAt = Date.now();
                state.phase = 'ready';
                loadDirectory(state.currentPath);
                fetchDiskInfo();
            }
        };
        state.eventSource.onerror = function() {
            setTimeout(connectSSE, 3000);
        };
    }

    function updateStatus(data) {
        statusInfo.textContent = `${data.total_size_human || '\u2014'} \u00b7 ${formatNum(data.files_scanned || 0)} files \u00b7 ${(data.elapsed_secs || 0).toFixed(1)}s`;
        const pct = data.scan_complete ? 100 : Math.min(95, Math.log10((data.files_scanned || 1) + 1) * 20);
        progressBar.style.width = pct + '%';
        progressBar.classList.toggle('complete', data.scan_complete);
        state.scanComplete = data.scan_complete;
    }

    // --- Disk info ---
    async function fetchDiskInfo() {
        try {
            const resp = await fetch('/api/diskinfo');
            if (!resp.ok) return;
            state.diskInfo = await resp.json();
            updateDiskSummary();
        } catch (e) {}
    }

    function updateDiskSummary() {
        if (!state.diskInfo) return;
        const d = state.diskInfo;
        const usedPct = Math.round((d.used / d.total) * 100);
        $('diskBarFill').style.width = usedPct + '%';
        $('diskText').textContent = `${d.available_human} free of ${d.total_human}`;
    }

    // --- API ---
    async function startScan(path) {
        state.scanComplete = false;
        state.scanStartedAt = null;
        state.currentPath = path;
        state.rootPath = path;
        state.treeCache = {};
        state.selected.clear();
        state.cleanupData = null;
        state.typesData = null;
        state.phase = 'scanning';
        updateSelectionTray();

        landing.style.display = 'none';
        appLayout.style.display = 'flex';

        try {
            const resp = await fetch('/api/scan?path=' + encodeURIComponent(path));
            if (resp.status === 409) { /* already scanning */ }
        } catch (e) {
            console.error('Scan start failed:', e);
        }

        connectSSE();
        state.activeTab = 'explore';
        browserList.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Scanning...</div>';
        renderBreadcrumb();
        pollTree();
    }

    function pollTree() {
        if (state.scanComplete) return;
        setTimeout(async () => {
            // Clear cache to get fresh data during scanning
            delete state.treeCache[state.currentPath];
            await loadDirectory(state.currentPath);
            if (!state.scanComplete) pollTree();
        }, 800);
    }

    async function fetchTreeNode(path) {
        if (state.treeCache[path]) return state.treeCache[path];
        try {
            const resp = await fetch('/api/tree?path=' + encodeURIComponent(path));
            if (!resp.ok) return null;
            const data = await resp.json();
            state.treeCache[data.path] = data;
            return data;
        } catch (e) {
            return null;
        }
    }

    // --- Navigation ---
    async function loadDirectory(path) {
        const data = await fetchTreeNode(path);
        if (!data) return;
        state.currentData = data;
        state.currentPath = data.path;
        state.treeCache[data.path] = data;
        state.selectedIndex = -1;

        if (state.activeTab === 'explore') {
            renderBrowserList(browserList, data);
            state.sunburstCenterPath = data.path;
            drawSunburst(data);
        }
        renderBreadcrumb();
    }

    function navigateTo(path) {
        state.currentPath = path;
        // Invalidate cache for fresh data during scanning
        if (!state.scanComplete) delete state.treeCache[path];
        loadDirectory(path);
    }

    function navigateUp() {
        if (!state.currentPath || state.currentPath === state.rootPath) return;
        const parts = state.currentPath.replace(/\/$/, '').split('/');
        parts.pop();
        navigateTo(parts.join('/') || '/');
    }

    // --- Browser list renderer ---
    function renderBrowserList(container, data) {
        container.innerHTML = '';
        if (!data || !data.children || data.children.length === 0) {
            container.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Empty</div>';
            return;
        }

        const sorted = [...data.children].sort((a, b) => b.size - a.size);
        const parentSize = data.size || 1;

        const mainItems = [];
        const smallItems = [];
        const hiddenItems = [];

        sorted.forEach(child => {
            if (child.name.startsWith('.')) hiddenItems.push(child);
            else if (child.percent < 1) smallItems.push(child);
            else mainItems.push(child);
        });

        mainItems.forEach((child, i) => {
            container.appendChild(createBrowserRow(child, i, parentSize));
        });

        if (smallItems.length > 0) {
            appendCollapsibleGroup(container, `Small items (${smallItems.length})`, smallItems, mainItems.length, parentSize);
        }
        if (hiddenItems.length > 0) {
            appendCollapsibleGroup(container, `Hidden items (${hiddenItems.length})`, hiddenItems, mainItems.length + smallItems.length, parentSize);
        }
    }

    function createBrowserRow(child, index, parentSize) {
        const row = document.createElement('div');
        row.className = 'browser-row';
        row.dataset.path = child.path;
        row.dataset.index = index;

        // Checkbox
        const cb = document.createElement('div');
        cb.className = 'row-checkbox' + (state.selected.has(child.path) ? ' checked' : '');
        if (state.selected.has(child.path)) cb.innerHTML = ICONS.check;
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSelection(child, cb);
        });

        // Icon — colored to match sunburst segment
        const icon = document.createElement('span');
        icon.className = 'row-icon';
        icon.innerHTML = child.has_children ? ICONS.folder : ICONS.file;
        const segColor = SUNBURST_COLORS[index % SUNBURST_COLORS.length];
        if (child.has_children) {
            icon.style.color = segColor;
        }

        // Name
        const name = document.createElement('span');
        name.className = 'row-name';
        name.textContent = child.name;

        // Percentage bar — colored to match sunburst segment
        const barWrap = document.createElement('div');
        barWrap.className = 'row-bar';
        const barFill = document.createElement('div');
        barFill.className = 'row-bar-fill';
        const pct = parentSize > 0 ? Math.max(1, (child.size / parentSize) * 100) : 0;
        barFill.style.width = pct + '%';
        barFill.style.background = child.has_children ? segColor : 'var(--text-muted)';
        barWrap.appendChild(barFill);

        // Size
        const size = document.createElement('span');
        size.className = 'row-size ' + sizeColorClass(child.size_human);
        size.textContent = child.size_human;

        row.appendChild(cb);
        row.appendChild(icon);
        row.appendChild(name);
        row.appendChild(barWrap);
        row.appendChild(size);

        // Click: drill into directory
        row.addEventListener('click', () => {
            if (child.has_children) {
                navigateTo(child.path);
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

    function appendCollapsibleGroup(container, label, items, startIndex, parentSize) {
        const toggle = document.createElement('div');
        toggle.className = 'browser-group-toggle';
        const chevron = document.createElement('span');
        chevron.className = 'group-chevron';
        chevron.innerHTML = ICONS.chevronRight;
        const text = document.createElement('span');
        text.textContent = label;
        toggle.appendChild(chevron);
        toggle.appendChild(text);

        const groupDiv = document.createElement('div');
        groupDiv.className = 'browser-group-items';
        items.forEach((child, i) => {
            groupDiv.appendChild(createBrowserRow(child, startIndex + i, parentSize));
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
        if (state.selected.has(child.path)) {
            state.selected.delete(child.path);
            if (cbEl) { cbEl.classList.remove('checked'); cbEl.innerHTML = ''; }
        } else {
            state.selected.set(child.path, {
                name: child.name,
                size: child.size,
                size_human: child.size_human,
                has_children: child.has_children
            });
            if (cbEl) { cbEl.classList.add('checked'); cbEl.innerHTML = ICONS.check; }
        }
        updateSelectionTray();
    }

    function updateSelectionTray() {
        const count = state.selected.size;
        if (count === 0) {
            selectionTray.classList.remove('visible');
            return;
        }
        selectionTray.classList.add('visible');
        let totalSize = 0;
        state.selected.forEach(v => totalSize += v.size);
        $('trayCount').textContent = count + ' item' + (count !== 1 ? 's' : '');
        $('traySize').textContent = formatSize(totalSize);
    }

    // Select all in current view
    $('selectAllBtn').addEventListener('click', () => {
        if (!state.currentData || !state.currentData.children) return;
        const allSelected = state.currentData.children.every(c => state.selected.has(c.path));
        state.currentData.children.forEach(child => {
            if (allSelected) {
                state.selected.delete(child.path);
            } else {
                state.selected.set(child.path, {
                    name: child.name, size: child.size,
                    size_human: child.size_human, has_children: child.has_children
                });
            }
        });
        refreshCheckboxes();
        updateSelectionTray();
    });

    // Tray buttons
    $('trayClear').addEventListener('click', () => {
        state.selected.clear();
        refreshCheckboxes();
        updateSelectionTray();
    });

    $('trayReview').addEventListener('click', openReview);

    // --- Breadcrumb ---
    function renderBreadcrumb() {
        breadcrumb.innerHTML = '';
        const fullPath = state.currentPath || state.rootPath;
        const parts = fullPath.split('/').filter(Boolean);
        let accumulated = '';

        const rootEl = document.createElement('span');
        rootEl.className = 'breadcrumb-item' + (parts.length === 0 ? ' active' : '');
        rootEl.textContent = '/';
        rootEl.onclick = () => navigateTo(state.rootPath);
        breadcrumb.appendChild(rootEl);

        parts.forEach((part, i) => {
            accumulated += '/' + part;
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.innerHTML = ICONS.chevronRight;
            breadcrumb.appendChild(sep);

            const el = document.createElement('span');
            el.className = 'breadcrumb-item' + (i === parts.length - 1 ? ' active' : '');
            el.textContent = part;
            const path = accumulated;
            el.onclick = () => navigateTo(path);
            breadcrumb.appendChild(el);
        });
    }

    // --- Tab system ---
    const tabIndicator = $('tabIndicator');

    function updateTabIndicator() {
        const activeBtn = document.querySelector('.tab.active');
        if (!activeBtn || !tabIndicator) return;
        const tabBar = activeBtn.parentElement;
        const barRect = tabBar.getBoundingClientRect();
        const btnRect = activeBtn.getBoundingClientRect();
        tabIndicator.style.left = (btnRect.left - barRect.left) + 'px';
        tabIndicator.style.width = btnRect.width + 'px';
    }

    function setActiveTab(tabName) {
        state.activeTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            const isActive = tab.dataset.tab === tabName;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        // Update sliding indicator
        updateTabIndicator();

        // Update panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.tab === tabName);
        });

        // Lazy-load tab content
        if (tabName === 'explore' && state.currentData) {
            renderBrowserList(browserList, state.currentData);
            requestAnimationFrame(() => drawSunburst(state.currentData));
        } else if (tabName === 'biggest') {
            loadBiggestFiles();
        } else if (tabName === 'cleanup') {
            loadCleanupTab();
        } else if (tabName === 'types') {
            loadTypesTab();
        }
    }

    // Tab click handlers
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
    });

    // Update indicator on resize
    window.addEventListener('resize', () => updateTabIndicator());
    // Initial indicator position
    requestAnimationFrame(() => updateTabIndicator());

    // --- Biggest Files tab ---
    async function loadBiggestFiles() {
        const list = $('biggestList');
        list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Loading...</div>';

        const files = [];
        for (const path in state.treeCache) {
            const data = state.treeCache[path];
            if (!data || !data.children) continue;
            data.children.forEach(child => {
                if (!child.has_children) files.push(child);
            });
        }

        const seen = new Set();
        const unique = [];
        files.sort((a, b) => b.size - a.size);
        files.forEach(f => {
            if (!seen.has(f.path)) { seen.add(f.path); unique.push(f); }
        });

        list.innerHTML = '';
        if (unique.length === 0) {
            list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;font-size:13px">Scan more to populate this view</div>';
            return;
        }

        const maxSize = unique[0].size || 1;
        unique.slice(0, 200).forEach((child, i) => {
            list.appendChild(createBrowserRow(child, i, maxSize));
        });
    }

    // --- Smart Cleanup tab ---
    async function loadCleanupTab() {
        const list = $('cleanupList');
        const total = $('cleanupTotal');
        const filters = $('cleanupFilters');

        if (state.cleanupData) {
            renderCleanupItems(state.cleanupData);
            return;
        }

        list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Analyzing...</div>';

        try {
            const resp = await fetch('/api/smart');
            if (!resp.ok) return;
            state.cleanupData = await resp.json();
            renderCleanupItems(state.cleanupData);

            // Update badge
            const badge = $('cleanupBadge');
            if (state.cleanupData.items.length > 0) {
                badge.textContent = state.cleanupData.items.length;
                badge.style.display = '';
            }
        } catch (e) {
            list.innerHTML = '<div style="padding:20px;color:var(--danger)">Failed to load</div>';
        }
    }

    function renderCleanupItems(data) {
        const list = $('cleanupList');
        const total = $('cleanupTotal');
        const filters = $('cleanupFilters');

        total.textContent = data.total_size_human + ' recoverable';

        // Build category filter chips
        const categories = [...new Set(data.items.map(i => i.category))];
        filters.innerHTML = '';
        const allChip = document.createElement('button');
        allChip.className = 'filter-chip' + (state.cleanupFilter === 'all' ? ' active' : '');
        allChip.textContent = 'All';
        allChip.addEventListener('click', () => { state.cleanupFilter = 'all'; renderCleanupItems(data); });
        filters.appendChild(allChip);

        categories.forEach(cat => {
            const chip = document.createElement('button');
            chip.className = 'filter-chip' + (state.cleanupFilter === cat ? ' active' : '');
            chip.textContent = cat;
            chip.addEventListener('click', () => { state.cleanupFilter = cat; renderCleanupItems(data); });
            filters.appendChild(chip);
        });

        // Filter items
        const items = state.cleanupFilter === 'all' ? data.items : data.items.filter(i => i.category === state.cleanupFilter);

        list.innerHTML = '';
        if (items.length === 0) {
            list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No cleanup suggestions</div>';
            return;
        }

        items.forEach(item => {
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

            el.addEventListener('click', () => {
                setActiveTab('explore');
                navigateTo(item.path);
            });
            el.addEventListener('contextmenu', (e) => showContextMenu(e, { path: item.path, name: item.name, size_human: item.size_human, has_children: true }));
            list.appendChild(el);
        });
    }

    // --- File Types tab ---
    async function loadTypesTab() {
        const list = $('typesList');

        if (state.typesData) {
            renderTypesItems(state.typesData);
            return;
        }

        list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">Loading...</div>';

        try {
            const resp = await fetch('/api/types');
            if (!resp.ok) return;
            state.typesData = await resp.json();
            renderTypesItems(state.typesData);
        } catch (e) {
            list.innerHTML = '<div style="padding:20px;color:var(--danger)">Failed to load</div>';
        }
    }

    function renderTypesItems(data) {
        const list = $('typesList');
        list.innerHTML = '';
        if (!data.types || data.types.length === 0) {
            list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No type data</div>';
            return;
        }
        const maxSize = data.types[0].size || 1;
        data.types.slice(0, 50).forEach(t => {
            const el = document.createElement('div');
            el.className = 'type-item';
            el.innerHTML = `<span class="type-ext">.${escHtml(t.extension)}</span><div class="type-bar-wrap"><div class="type-bar" style="width:${Math.max(1, (t.size / maxSize) * 100)}%"></div></div><span class="type-meta">${t.size_human}<br><span class="type-count">${formatNum(t.count)} files</span></span>`;
            list.appendChild(el);
        });
    }

    // --- Sunburst Chart ---
    function drawSunburst(rootData, skipFetch) {
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = '';
        canvas.style.height = '';
        const rect = canvas.getBoundingClientRect();

        if (!rootData || !rootData.children || rootData.children.length === 0) {
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, rect.width, rect.height);
            state.sunburstRings = [];
            return;
        }

        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, rect.width, rect.height);

        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const maxRadius = Math.min(cx, cy) - 20;
        const innerRadius = 65;
        const depth = 3;
        const ringWidth = (maxRadius - innerRadius) / depth;
        const GAP = 0.004; // radians gap between segments

        state.sunburstRings = [];

        const totalSize = rootData.size || 1;
        let startAngle = -Math.PI / 2;

        const level0 = rootData.children.filter(c => c.size > 0).sort((a, b) => b.size - a.size);
        level0.forEach((child, i) => {
            const sweep = (child.size / totalSize) * Math.PI * 2;
            if (sweep < 0.005) { startAngle += sweep; return; }

            const color = SUNBURST_COLORS[i % SUNBURST_COLORS.length];
            const r0 = innerRadius;
            const r1 = innerRadius + ringWidth;
            const aStart = startAngle + GAP;
            const aEnd = startAngle + sweep - GAP;

            drawArc(cx, cy, r0, r1, aStart, aEnd, color, 0.95);
            state.sunburstRings.push({ cx, cy, r0, r1, startAngle, endAngle: startAngle + sweep, data: child, level: 0, color });

            // Level 1
            const childData = state.treeCache[child.path];
            if (childData && childData.children) {
                let subStart = startAngle;
                const subChildren = childData.children.filter(c => c.size > 0).sort((a, b) => b.size - a.size);
                subChildren.forEach((gc, gi) => {
                    const subSweep = (gc.size / totalSize) * Math.PI * 2;
                    if (subSweep < 0.005) { subStart += subSweep; return; }

                    const subColor = adjustBrightness(color, gi % 2 === 0 ? -15 : 15);
                    const sr0 = innerRadius + ringWidth;
                    const sr1 = innerRadius + ringWidth * 2;
                    const sStart = subStart + GAP;
                    const sEnd = subStart + subSweep - GAP;

                    drawArc(cx, cy, sr0, sr1, sStart, sEnd, subColor, 0.85);
                    state.sunburstRings.push({ cx, cy, r0: sr0, r1: sr1, startAngle: subStart, endAngle: subStart + subSweep, data: gc, level: 1, color: subColor });

                    // Level 2
                    const gcData = state.treeCache[gc.path];
                    if (gcData && gcData.children) {
                        let ggStart = subStart;
                        const ggChildren = gcData.children.filter(c => c.size > 0).sort((a, b) => b.size - a.size);
                        ggChildren.forEach((ggc, ggi) => {
                            const ggSweep = (ggc.size / totalSize) * Math.PI * 2;
                            if (ggSweep < 0.005) { ggStart += ggSweep; return; }

                            const ggColor = adjustBrightness(subColor, ggi % 2 === 0 ? -10 : 10);
                            const gr0 = innerRadius + ringWidth * 2;
                            const gr1 = innerRadius + ringWidth * 3;
                            const gStart = ggStart + GAP;
                            const gEnd = ggStart + ggSweep - GAP;

                            drawArc(cx, cy, gr0, gr1, gStart, gEnd, ggColor, 0.75);
                            state.sunburstRings.push({ cx, cy, r0: gr0, r1: gr1, startAngle: ggStart, endAngle: ggStart + ggSweep, data: ggc, level: 2, color: ggColor });
                            ggStart += ggSweep;
                        });
                    }
                    subStart += subSweep;
                });
            }
            startAngle += sweep;
        });

        // Center circle with radial gradient
        const centerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerRadius - 2);
        const bgSurface = getComputedStyle(document.body).getPropertyValue('--bg-surface').trim() || '#0c0c0e';
        const bgRoot = getComputedStyle(document.body).getPropertyValue('--bg-root').trim() || '#050506';
        centerGrad.addColorStop(0, bgSurface);
        centerGrad.addColorStop(1, bgRoot);
        ctx.beginPath();
        ctx.arc(cx, cy, innerRadius - 2, 0, Math.PI * 2);
        ctx.fillStyle = centerGrad;
        ctx.fill();

        // Center label
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary').trim() || '#ededef';
        ctx.font = '600 14px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let centerLabel = rootData.name;
        if (ctx.measureText(centerLabel).width > innerRadius * 1.6) {
            centerLabel = centerLabel.slice(0, 8) + '\u2026';
        }
        ctx.fillText(centerLabel, cx, cy - 10);
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary').trim() || '#8b8b96';
        ctx.font = '12px JetBrains Mono, monospace';
        ctx.fillText(rootData.size_human, cx, cy + 10);

        if (!skipFetch) fetchSunburstLevels(rootData);
    }

    async function fetchSunburstLevels(rootData) {
        if (!rootData || !rootData.children) return;
        const totalSize = rootData.size || 1;

        const toFetch1 = rootData.children.filter(c => c.has_children && (c.size / totalSize) > 0.02 && !state.treeCache[c.path]);
        const fetched1 = await Promise.all(toFetch1.map(c => fetchTreeNode(c.path)));
        if (fetched1.some(d => d)) drawSunburst(rootData, true);

        const toFetch2 = [];
        rootData.children.forEach(c => {
            const cData = state.treeCache[c.path];
            if (cData && cData.children) {
                cData.children.forEach(gc => {
                    if (gc.has_children && (gc.size / totalSize) > 0.02 && !state.treeCache[gc.path]) {
                        toFetch2.push(gc);
                    }
                });
            }
        });
        const fetched2 = await Promise.all(toFetch2.map(c => fetchTreeNode(c.path)));
        if (fetched2.some(d => d)) drawSunburst(rootData, true);
    }

    function drawArc(cx, cy, r0, r1, start, end, color, alpha) {
        ctx.beginPath();
        ctx.arc(cx, cy, r1, start, end);
        ctx.arc(cx, cy, r0, end, start, true);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fill();
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

    function sunburstHitTest(x, y) {
        if (state.sunburstRings.length === 0) return null;
        const ring0 = state.sunburstRings[0];
        const cx = ring0.cx, cy = ring0.cy;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        let angle = Math.atan2(dy, dx);

        for (const seg of state.sunburstRings) {
            if (dist >= seg.r0 && dist <= seg.r1) {
                let a = angle;
                let s = seg.startAngle;
                while (a < s) a += Math.PI * 2;
                while (a > s + Math.PI * 2) a -= Math.PI * 2;
                if (a >= s && a <= seg.endAngle) return seg;
            }
        }
        if (dist < 65) return { isCenter: true };
        return null;
    }

    // Canvas events
    canvas.addEventListener('mousemove', e => {
        if (state.sunburstRAF) return;
        state.sunburstRAF = requestAnimationFrame(() => {
            state.sunburstRAF = null;
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
                if (hit.data.newest_mtime) detail += '<br>Modified: ' + formatDate(hit.data.newest_mtime);
                detail += '<br>' + formatNum(hit.data.file_count) + ' files \u00b7 ' + formatNum(hit.data.dir_count) + ' dirs';
                tooltipDetail.innerHTML = detail;
                canvas.style.cursor = hit.data.has_children ? 'pointer' : 'default';

                if (state.sunburstHovered !== hit) {
                    state.sunburstHovered = hit;
                    redrawSunburstHighlight();
                }
            } else if (hit && hit.isCenter) {
                tooltip.style.display = 'none';
                canvas.style.cursor = 'pointer';
                state.sunburstHovered = null;
            } else {
                tooltip.style.display = 'none';
                canvas.style.cursor = 'default';
                if (state.sunburstHovered) {
                    state.sunburstHovered = null;
                    redrawSunburstHighlight();
                }
            }
        });
    });

    canvas.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        state.sunburstHovered = null;
        if (state.currentData) drawSunburst(state.currentData, true);
    });

    canvas.addEventListener('click', e => {
        const rect = canvas.getBoundingClientRect();
        const hit = sunburstHitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
            if (hit.isCenter) navigateUp();
            else if (hit.data && hit.data.has_children) navigateTo(hit.data.path);
        }
    });

    function redrawSunburstHighlight() {
        if (!state.currentData) return;
        drawSunburst(state.currentData, true);
        if (!state.sunburstHovered || !state.sunburstHovered.data) return;

        const seg = state.sunburstHovered;
        ctx.save();
        ctx.shadowColor = seg.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(seg.cx, seg.cy, seg.r1 + 2, seg.startAngle, seg.endAngle);
        ctx.arc(seg.cx, seg.cy, seg.r0 - 1, seg.endAngle, seg.startAngle, true);
        ctx.closePath();
        ctx.fillStyle = adjustBrightness(seg.color, 40);
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.restore();
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (state.currentData && state.activeTab === 'explore') drawSunburst(state.currentData, true);
        }, 100);
    });

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

    function hideContextMenu() { contextMenu.style.display = 'none'; ctxTarget = null; }

    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('.browser-row') && !e.target.closest('.smart-item')) hideContextMenu();
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
                    el.innerHTML = `<span class="search-item-icon">${item.has_children ? ICONS.folder : ICONS.file}</span><div class="search-item-info"><div class="search-item-name">${escHtml(item.name)}</div><div class="search-item-path">${escHtml(item.path)}</div></div><span class="search-item-size">${item.size_human}</span>`;
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
                state.selected.delete(pendingDeletePath);
                updateSelectionTray();
                delete state.treeCache[state.currentPath];
                loadDirectory(state.currentPath);
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
    function openReview() {
        if (state.selected.size === 0) return;
        const overlay = $('reviewOverlay');
        const list = $('reviewList');
        const total = $('reviewTotal');

        let totalSize = 0;
        state.selected.forEach(v => totalSize += v.size);
        total.textContent = formatSize(totalSize);

        list.innerHTML = '';
        state.selected.forEach((info, path) => {
            const el = document.createElement('div');
            el.className = 'review-item';
            el.innerHTML = `<div class="review-info"><div class="review-name">${escHtml(info.name)}</div><div class="review-path">${escHtml(path)}</div></div><span class="review-size">${info.size_human}</span>`;
            const uncheckBtn = document.createElement('button');
            uncheckBtn.className = 'review-uncheck';
            uncheckBtn.textContent = 'Remove';
            uncheckBtn.addEventListener('click', () => {
                state.selected.delete(path);
                updateSelectionTray();
                el.remove();
                let newTotal = 0;
                state.selected.forEach(v => newTotal += v.size);
                total.textContent = formatSize(newTotal);
                if (state.selected.size === 0) overlay.classList.remove('open');
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

        const paths = [...state.selected.keys()];
        for (const path of paths) {
            try {
                const resp = await fetch('/api/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path })
                });
                const result = await resp.json();
                if (result.success) state.selected.delete(path);
            } catch (e) {}
        }

        btn.textContent = 'Delete All Selected';
        btn.disabled = false;
        updateSelectionTray();
        $('reviewOverlay').classList.remove('open');

        delete state.treeCache[state.currentPath];
        loadDirectory(state.currentPath);
    });

    function refreshCheckboxes() {
        document.querySelectorAll('.row-checkbox').forEach(cb => {
            const row = cb.closest('.browser-row');
            if (row) {
                const path = row.dataset.path;
                const isChecked = state.selected.has(path);
                cb.classList.toggle('checked', isChecked);
                cb.innerHTML = isChecked ? ICONS.check : '';
            }
        });
    }

    // --- Theme toggle ---
    const themeIcon = $('themeIcon');
    state.isDark = localStorage.getItem('ddcleaner-theme') !== 'light';
    if (!localStorage.getItem('ddcleaner-theme')) {
        state.isDark = !window.matchMedia('(prefers-color-scheme: light)').matches;
    }

    function applyTheme() {
        document.body.classList.toggle('light', !state.isDark);
        themeIcon.innerHTML = state.isDark ? ICONS.moon : ICONS.sun;
        localStorage.setItem('ddcleaner-theme', state.isDark ? 'dark' : 'light');
    }
    applyTheme();

    $('themeToggle').addEventListener('click', () => {
        state.isDark = !state.isDark;
        applyTheme();
        if (state.currentData && state.activeTab === 'explore') {
            requestAnimationFrame(() => drawSunburst(state.currentData, true));
        }
    });

    // --- Keyboard shortcuts ---
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); return; }

        if (e.key === 'Escape') {
            if (searchOverlay.classList.contains('open')) { closeSearch(); return; }
            if (deleteOverlay.classList.contains('open')) { deleteOverlay.classList.remove('open'); return; }
            if ($('reviewOverlay').classList.contains('open')) { $('reviewOverlay').classList.remove('open'); return; }
            navigateUp();
            return;
        }

        if (e.target.tagName === 'INPUT') return;

        // Tab shortcuts: 1-4
        if (e.key === '1') { setActiveTab('explore'); return; }
        if (e.key === '2') { setActiveTab('biggest'); return; }
        if (e.key === '3') { setActiveTab('cleanup'); return; }
        if (e.key === '4') { setActiveTab('types'); return; }

        if (e.key === 'Backspace') { navigateUp(); e.preventDefault(); return; }
        if (e.key === 'r' || e.key === 'R') { rescan(); return; }
        if (e.key === 't' || e.key === 'T') {
            state.isDark = !state.isDark; applyTheme();
            if (state.currentData && state.activeTab === 'explore') requestAnimationFrame(() => drawSunburst(state.currentData, true));
            return;
        }

        // Arrow keys for browser navigation
        if (state.activeTab !== 'explore' || !state.currentData || !state.currentData.children) return;
        const children = state.currentData.children;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.selectedIndex = Math.min(state.selectedIndex + 1, children.length - 1);
            highlightBrowserRow(browserList, state.selectedIndex);
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.selectedIndex = Math.max(state.selectedIndex - 1, 0);
            highlightBrowserRow(browserList, state.selectedIndex);
        }
        if (e.key === 'Enter') {
            if (state.selectedIndex >= 0 && state.selectedIndex < children.length) {
                const child = children[state.selectedIndex];
                if (child.has_children) navigateTo(child.path);
            }
        }
        if (e.key === ' ') {
            e.preventDefault();
            if (state.selectedIndex >= 0 && state.selectedIndex < children.length) {
                const child = children[state.selectedIndex];
                const rows = browserList.querySelectorAll('.browser-row');
                if (rows[state.selectedIndex]) {
                    const cb = rows[state.selectedIndex].querySelector('.row-checkbox');
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
        if (!state.rootPath) return;
        startScan(state.rootPath);
    }
    $('rescanBtn').addEventListener('click', rescan);

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

    // Custom path toggle
    $('customPathToggle').addEventListener('click', () => {
        const form = $('scanForm');
        const isHidden = form.style.display === 'none';
        form.style.display = isHidden ? 'flex' : 'none';
        if (isHidden) scanInput.focus();
    });

    // --- Volume picker ---
    async function loadVolumes() {
        const list = $('volumeList');
        try {
            const resp = await fetch('/api/volumes');
            if (!resp.ok) throw new Error('Failed');
            const volumes = await resp.json();
            if (volumes.length === 0) {
                list.innerHTML = '<div class="volume-loading">No volumes detected</div>';
                // Show manual input as fallback
                $('scanForm').style.display = 'flex';
                return;
            }
            list.innerHTML = '';

            const diskIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>';

            volumes.forEach(vol => {
                const card = document.createElement('div');
                card.className = 'volume-card';

                const barClass = vol.use_percent > 90 ? 'critical' : vol.use_percent > 75 ? 'warn' : '';

                card.innerHTML = `
                    <div class="volume-icon">${diskIcon}</div>
                    <div class="volume-info">
                        <div class="volume-name">${escHtml(vol.label)}</div>
                        <div class="volume-meta">
                            <span>${vol.available_human} free of ${vol.total_human}</span>
                            <span class="volume-mount">${escHtml(vol.mount_point)}</span>
                        </div>
                        <div class="volume-bar-wrap">
                            <div class="volume-bar-fill ${barClass}" style="width:${vol.use_percent.toFixed(1)}%"></div>
                        </div>
                    </div>
                    <div class="volume-size">${Math.round(vol.use_percent)}%</div>
                `;

                card.addEventListener('click', () => startScan(vol.mount_point));
                list.appendChild(card);
            });
        } catch (e) {
            list.innerHTML = '<div class="volume-loading">Could not detect volumes</div>';
            $('scanForm').style.display = 'flex';
        }
    }

    // --- Auto-start ---
    async function init() {
        try {
            const resp = await fetch('/api/status');
            if (resp.ok) {
                const data = await resp.json();
                if (data.root_path && data.root_path !== '.' && data.files_scanned > 0) {
                    state.rootPath = data.root_path;
                    state.currentPath = data.root_path;
                    state.scanComplete = data.scan_complete;
                    if (state.scanComplete) {
                        state.scanStartedAt = Date.now();
                        state.phase = 'ready';
                    }

                    landing.style.display = 'none';
                    appLayout.style.display = 'flex';

                    updateStatus(data);
                    connectSSE();
                    fetchDiskInfo();
                    // Defer loadDirectory to next frame so layout is computed
                    requestAnimationFrame(() => loadDirectory(state.currentPath));
                    return;
                }
            }
        } catch (e) {}
        landing.style.display = 'flex';
        loadVolumes();
    }

    init();
})();
