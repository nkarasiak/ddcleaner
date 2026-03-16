// ddcleaner — Frontend Application
(function() {
    'use strict';

    // --- State ---
    let currentPath = '';
    let rootPath = '';
    let treeData = null;
    let scanComplete = false;
    let scanStartedAt = null;
    let selectedIndex = -1;
    let treemapRects = [];
    let hoveredRect = null;
    let eventSource = null;
    let cachedImageData = null;
    let currentLayout = localStorage.getItem('ddcleaner-layout') || 'explorer';
    let treeCache = {};
    let expandedPaths = new Set();

    // --- DOM refs ---
    const $ = id => document.getElementById(id);
    const progressBar = $('progressBar');
    const statusInfo = $('statusInfo');
    const freshnessDot = $('freshnessDot');
    const freshnessText = $('freshnessText');
    const breadcrumbBar = $('breadcrumbBar');
    const breadcrumb = $('breadcrumb');
    const landing = $('landing');
    const mainContent = $('mainContent');
    const bottomBar = $('bottomBar');
    const scanInput = $('scanInput');
    const scanBtn = $('scanBtn');
    const rescanBtn = $('rescanBtn');
    const listContainer = $('listContainer');
    const errorContainer = $('errorContainer');
    const canvas = $('treemapCanvas');
    const ctx = canvas.getContext('2d');
    const tooltip = $('tooltip');
    const tooltipName = $('tooltipName');
    const tooltipDetail = $('tooltipDetail');
    const shortcutsOverlay = $('shortcutsOverlay');
    const shortcutHint = $('shortcutHint');
    const treeContainer = $('treeContainer');
    const contextMenu = $('contextMenu');
    const smartOverlay = $('smartOverlay');
    const smartList = $('smartList');
    const smartTotal = $('smartTotal');
    const smartBtn = $('smartBtn');
    const smartClose = $('smartClose');

    // --- Context menu state ---
    let ctxTarget = null; // { path, name, size_human, has_children }

    // --- Color helpers ---
    function sizeShareColor(percent) {
        if (percent >= 70) return '#b91c1c';
        if (percent >= 50) return '#b45309';
        if (percent >= 30) return '#92400e';
        if (percent >= 15) return '#166534';
        if (percent >= 5) return '#1e4d4d';
        return '#1c1c20';
    }

    function sizeShareColorLight(percent) {
        if (percent >= 70) return '#dc2626';
        if (percent >= 50) return '#d97706';
        if (percent >= 30) return '#b45309';
        if (percent >= 15) return '#16a34a';
        if (percent >= 5) return '#2d8a8a';
        return '#27272a';
    }

    // --- Number formatting ---
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

    // --- Freshness ---
    function updateFreshness() {
        if (!scanStartedAt) return;
        if (!scanComplete) {
            freshnessDot.className = 'freshness-dot scanning';
            freshnessText.textContent = 'Scanning...';
            return;
        }
        const ago = (Date.now() - scanStartedAt) / 1000;
        let cls = 'fresh', text = '';
        if (ago < 60) {
            text = `Scanned ${Math.round(ago)}s ago`;
            cls = 'fresh';
        } else if (ago < 300) {
            text = `Scanned ${Math.round(ago / 60)}m ago`;
            cls = 'aging';
        } else {
            text = `Scanned ${Math.round(ago / 60)}m ago`;
            cls = 'stale';
        }
        freshnessDot.className = 'freshness-dot ' + cls;
        freshnessText.textContent = text;
    }

    setInterval(updateFreshness, 1000);

    // --- Layout switching ---
    function setLayout(name) {
        currentLayout = name;
        document.body.dataset.layout = name;
        localStorage.setItem('ddcleaner-layout', name);

        // Update button active states
        document.querySelectorAll('.layout-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.layout === name);
        });

        // Re-layout treemap if visible
        if (name !== 'list') {
            requestAnimationFrame(() => layoutTreemap());
        }

        // Render tree if explorer
        if (name === 'explorer' && rootPath) {
            renderTree();
        }
    }

    // Init layout buttons
    document.querySelectorAll('.layout-btn').forEach(btn => {
        btn.addEventListener('click', () => setLayout(btn.dataset.layout));
    });

    // Apply saved layout
    setLayout(currentLayout);

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
                fetchTree(currentPath);
            }
        };
        eventSource.onerror = function() {
            setTimeout(connectSSE, 3000);
        };
    }

    function updateStatus(data) {
        statusInfo.textContent = `${data.total_size_human || '—'} · ${formatNum(data.files_scanned || 0)} files`;
        const pct = data.scan_complete ? 100 : Math.min(95, Math.log10((data.files_scanned || 1) + 1) * 20);
        progressBar.style.width = pct + '%';
        progressBar.classList.toggle('complete', data.scan_complete);
        scanComplete = data.scan_complete;

        // Bottom bar
        $('statFiles').textContent = formatNum(data.files_scanned || 0) + ' files';
        $('statDirs').textContent = formatNum(data.dirs_scanned || 0) + ' dirs';
        $('statSize').textContent = data.total_size_human || '—';
        $('statTime').textContent = 'Scan: ' + (data.elapsed_secs || 0).toFixed(1) + 's';
    }

    // --- API ---
    async function startScan(path) {
        scanComplete = false;
        scanStartedAt = null;
        currentPath = path;
        rootPath = path;
        treeCache = {};
        expandedPaths = new Set();

        landing.style.display = 'none';
        mainContent.style.display = 'flex';
        breadcrumbBar.style.display = 'flex';
        bottomBar.style.display = 'flex';

        try {
            const resp = await fetch('/api/scan?path=' + encodeURIComponent(path));
            if (resp.status === 409) {
                // Already scanning, just connect SSE
            }
        } catch (e) {
            console.error('Scan start failed:', e);
        }

        connectSSE();
        // Poll tree during scan
        pollTree();
    }

    function pollTree() {
        if (scanComplete) return;
        setTimeout(async () => {
            await fetchTree(currentPath);
            if (!scanComplete) pollTree();
        }, 800);
    }

    async function fetchTree(path) {
        try {
            const url = '/api/tree?path=' + encodeURIComponent(path || rootPath);
            const resp = await fetch(url);
            if (!resp.ok) return;
            treeData = await resp.json();
            currentPath = treeData.path;
            renderBreadcrumb();
            renderList();
            layoutTreemap();
            updateSRTree();

            // Cache for tree panel and render
            treeCache[treeData.path] = treeData;
            if (currentLayout === 'explorer') {
                autoExpandAncestors(currentPath);
                renderTree();
            }
        } catch (e) {
            console.error('Fetch tree failed:', e);
        }
    }

    async function fetchErrors() {
        try {
            const resp = await fetch('/api/errors');
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.count > 0) {
                renderErrors(data);
            }
        } catch (e) {}
    }

    // --- Navigation ---
    function navigateTo(path) {
        currentPath = path;
        selectedIndex = -1;
        fetchTree(path);
    }

    function navigateUp() {
        if (!currentPath || currentPath === rootPath) return;
        const parts = currentPath.replace(/\/$/, '').split('/');
        parts.pop();
        const parent = parts.join('/') || '/';
        navigateTo(parent);
    }

    // --- Breadcrumb ---
    function renderBreadcrumb() {
        if (!treeData) return;
        breadcrumb.innerHTML = '';

        const fullPath = currentPath || rootPath;
        const parts = fullPath.split('/').filter(Boolean);
        let accumulated = '';

        // Root
        const rootEl = document.createElement('span');
        rootEl.className = 'breadcrumb-item' + (parts.length === 0 ? ' active' : '');
        rootEl.textContent = '/';
        rootEl.onclick = () => navigateTo(rootPath);
        breadcrumb.appendChild(rootEl);

        parts.forEach((part, i) => {
            accumulated += '/' + part;
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.textContent = '›';
            breadcrumb.appendChild(sep);

            const el = document.createElement('span');
            el.className = 'breadcrumb-item' + (i === parts.length - 1 ? ' active' : '');
            el.textContent = part;
            const path = accumulated;
            el.onclick = () => navigateTo(path);
            breadcrumb.appendChild(el);
        });
    }

    // --- List ---
    function renderList() {
        if (!treeData || !treeData.children) return;
        listContainer.innerHTML = '';

        treeData.children.forEach((child, i) => {
            const item = document.createElement('div');
            item.className = 'list-item' + (i === selectedIndex ? ' selected' : '');
            item.role = 'treeitem';
            item.tabIndex = 0;

            const icon = document.createElement('span');
            icon.className = 'list-icon';
            icon.textContent = child.has_children ? '📁' : '📄';

            const name = document.createElement('span');
            name.className = 'list-name';
            name.textContent = child.name;

            const meta = document.createElement('div');
            meta.className = 'list-meta';

            const size = document.createElement('span');
            size.className = 'list-size';
            size.textContent = child.size_human;

            const pct = document.createElement('span');
            pct.className = 'list-percent';
            pct.textContent = child.percent.toFixed(1) + '%';

            meta.appendChild(size);
            meta.appendChild(pct);

            const barContainer = document.createElement('div');
            barContainer.className = 'list-bar-container';
            const bar = document.createElement('div');
            bar.className = 'list-bar';
            bar.style.width = Math.max(2, child.percent) + '%';
            bar.style.background = sizeShareColor(child.percent);
            barContainer.appendChild(bar);

            item.appendChild(icon);
            item.appendChild(name);
            item.appendChild(barContainer);
            item.appendChild(meta);

            item.onclick = () => {
                if (child.has_children) {
                    navigateTo(child.path);
                }
            };

            item.onmouseenter = () => {
                selectedIndex = i;
                highlightSelected();
            };

            item.addEventListener('contextmenu', (e) => {
                showContextMenu(e, {
                    path: child.path,
                    name: child.name,
                    size_human: child.size_human,
                    has_children: child.has_children
                });
            });

            listContainer.appendChild(item);
        });

        fetchErrors();
    }

    function highlightSelected() {
        const items = listContainer.querySelectorAll('.list-item');
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === selectedIndex);
        });
    }

    // --- Errors ---
    function renderErrors(data) {
        errorContainer.innerHTML = '';
        if (data.count === 0) return;

        const panel = document.createElement('div');
        panel.className = 'errors-panel';

        const header = document.createElement('div');
        header.className = 'errors-header';
        header.textContent = `⚠ ${data.count} scan error${data.count > 1 ? 's' : ''}`;

        const list = document.createElement('div');
        list.className = 'errors-list';
        data.errors.slice(0, 50).forEach(err => {
            const div = document.createElement('div');
            div.textContent = err;
            list.appendChild(div);
        });

        header.onclick = () => list.classList.toggle('open');
        panel.appendChild(header);
        panel.appendChild(list);
        errorContainer.appendChild(panel);
    }

    // --- Screen reader tree ---
    function updateSRTree() {
        const srTree = $('srTree');
        srTree.innerHTML = '';
        if (!treeData || !treeData.children) return;
        treeData.children.forEach(child => {
            const li = document.createElement('li');
            li.role = 'treeitem';
            li.textContent = `${child.name}, ${child.size_human}, ${child.percent.toFixed(1)} percent`;
            srTree.appendChild(li);
        });
    }

    // --- Treemap (squarified) ---
    // Phase 1: Split into layoutTreemap() + drawHover()

    function layoutTreemap() {
        if (!treeData || !treeData.children || treeData.children.length === 0) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            cachedImageData = null;
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

        treemapRects = [];

        const items = treeData.children.map(c => ({
            ...c,
            area: c.size
        }));

        const totalArea = items.reduce((s, c) => s + c.area, 0);
        if (totalArea === 0) return;

        const W = rect.width;
        const H = rect.height;
        const scale = (W * H) / totalArea;
        items.forEach(item => item.area = item.area * scale);

        squarify(items, { x: 0, y: 0, w: W, h: H });

        // Draw all rects in base colors (no hover)
        treemapRects.forEach(r => {
            ctx.fillStyle = sizeShareColor(r.data.percent);
            ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);

            // Border
            ctx.strokeStyle = '#09090b';
            ctx.lineWidth = 2;
            ctx.strokeRect(r.x, r.y, r.w, r.h);

            // Label
            if (r.w > 50 && r.h > 28) {
                ctx.fillStyle = '#fafafa';
                ctx.font = '600 12px Inter, system-ui, sans-serif';
                ctx.textBaseline = 'top';

                let label = r.data.name;
                const maxW = r.w - 12;
                while (ctx.measureText(label).width > maxW && label.length > 3) {
                    label = label.slice(0, -4) + '…';
                }
                ctx.fillText(label, r.x + 6, r.y + 6);

                if (r.h > 44) {
                    ctx.fillStyle = '#a1a1aa';
                    ctx.font = '11px JetBrains Mono, monospace';
                    ctx.fillText(r.data.size_human, r.x + 6, r.y + 22);
                }
            }
        });

        // Cache the base image
        cachedImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Draw current hover if any
        drawHover(hoveredRect);
    }

    function drawHover(rect) {
        if (!cachedImageData) return;

        // Restore base image
        ctx.putImageData(cachedImageData, 0, 0);

        if (!rect) return;

        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Redraw hovered rect with light color
        ctx.fillStyle = sizeShareColorLight(rect.data.percent);
        ctx.fillRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

        // White outline (2px inside)
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

        // Label
        if (rect.w > 50 && rect.h > 28) {
            ctx.fillStyle = '#fafafa';
            ctx.font = '600 12px Inter, system-ui, sans-serif';
            ctx.textBaseline = 'top';

            let label = rect.data.name;
            const maxW = rect.w - 12;
            while (ctx.measureText(label).width > maxW && label.length > 3) {
                label = label.slice(0, -4) + '…';
            }
            ctx.fillText(label, rect.x + 6, rect.y + 6);

            if (rect.h > 44) {
                ctx.fillStyle = '#a1a1aa';
                ctx.font = '11px JetBrains Mono, monospace';
                ctx.fillText(rect.data.size_human, rect.x + 6, rect.y + 22);
            }
        }
    }

    function squarify(items, rect) {
        if (items.length === 0) return;
        if (items.length === 1) {
            treemapRects.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, data: items[0] });
            return;
        }

        const isWide = rect.w >= rect.h;
        let row = [];
        let remaining = [...items];
        let best = Infinity;

        for (let i = 0; i < items.length; i++) {
            row.push(remaining.shift());
            const ratio = worstRatio(row, isWide ? rect.w : rect.h, rect);
            if (ratio <= best) {
                best = ratio;
            } else {
                remaining.unshift(row.pop());
                break;
            }
        }

        // Layout the row
        const rowArea = row.reduce((s, item) => s + item.area, 0);
        let x = rect.x, y = rect.y;

        if (isWide) {
            const rowW = rowArea / rect.h;
            row.forEach(item => {
                const h = item.area / rowW;
                treemapRects.push({ x, y, w: rowW, h, data: item });
                y += h;
            });
            squarify(remaining, { x: rect.x + rowW, y: rect.y, w: rect.w - rowW, h: rect.h });
        } else {
            const rowH = rowArea / rect.w;
            row.forEach(item => {
                const w = item.area / rowH;
                treemapRects.push({ x, y, w, h: rowH, data: item });
                x += w;
            });
            squarify(remaining, { x: rect.x, y: rect.y + rowH, w: rect.w, h: rect.h - rowH });
        }
    }

    function worstRatio(row, side, rect) {
        const totalArea = row.reduce((s, item) => s + item.area, 0);
        const isWide = rect.w >= rect.h;
        const length = isWide ? totalArea / rect.h : totalArea / rect.w;
        if (length === 0) return Infinity;

        let worst = 0;
        row.forEach(item => {
            const other = item.area / length;
            const ratio = Math.max(length / other, other / length);
            worst = Math.max(worst, ratio);
        });
        return worst;
    }

    // --- Canvas interaction ---
    canvas.addEventListener('mousemove', e => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let found = null;
        for (const r of treemapRects) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                found = r;
            }
        }

        if (found !== hoveredRect) {
            hoveredRect = found;
            drawHover(hoveredRect);
        }

        if (found) {
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 12) + 'px';
            tooltip.style.top = (e.clientY + 12) + 'px';
            tooltipName.textContent = found.data.name;
            tooltipDetail.innerHTML =
                found.data.size_human + ' · ' + found.data.percent.toFixed(1) + '%<br>' +
                formatNum(found.data.file_count) + ' files · ' + formatNum(found.data.dir_count) + ' dirs';
            canvas.style.cursor = found.data.has_children ? 'pointer' : 'default';
        } else {
            tooltip.style.display = 'none';
            canvas.style.cursor = 'default';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        hoveredRect = null;
        tooltip.style.display = 'none';
        drawHover(null);
    });

    canvas.addEventListener('click', e => {
        if (hoveredRect && hoveredRect.data.has_children) {
            navigateTo(hoveredRect.data.path);
        }
    });

    // --- Resize ---
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(layoutTreemap, 100);
    });

    // --- Folder tree panel (Phase 3) ---
    function autoExpandAncestors(path) {
        if (!rootPath || !path) return;
        // Build ancestor paths from rootPath to path
        const rootParts = rootPath.split('/').filter(Boolean);
        const pathParts = path.split('/').filter(Boolean);
        let accumulated = '';
        for (let i = 0; i < pathParts.length; i++) {
            accumulated += '/' + pathParts[i];
            if (i >= rootParts.length - 1) {
                expandedPaths.add(accumulated);
            }
        }
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

    function renderTree() {
        treeContainer.innerHTML = '';
        if (!rootPath) return;

        const rootData = treeCache[rootPath];
        if (!rootData) {
            // Fetch root and render
            fetchTreeNode(rootPath).then(() => renderTree());
            return;
        }

        renderTreeChildren(rootData, 0);

        // Scroll to active node
        requestAnimationFrame(() => {
            const active = treeContainer.querySelector('.tree-active');
            if (active) active.scrollIntoView({ block: 'nearest' });
        });
    }

    function renderTreeChildren(nodeData, depth) {
        if (!nodeData || !nodeData.children) return;

        // Sort children by size descending
        const sorted = [...nodeData.children].sort((a, b) => b.size - a.size);

        sorted.forEach(child => {
            const node = document.createElement('div');
            node.className = 'tree-node';
            if (child.path === currentPath) node.classList.add('tree-active');
            node.dataset.path = child.path;
            node.style.paddingLeft = (8 + depth * 16) + 'px';

            const chevron = document.createElement('span');
            chevron.className = 'tree-chevron';
            if (child.has_children) {
                chevron.textContent = '›';
                if (expandedPaths.has(child.path)) {
                    chevron.classList.add('expanded');
                }
            } else {
                chevron.classList.add('leaf');
            }

            const icon = document.createElement('span');
            icon.className = 'tree-icon';
            icon.textContent = child.has_children ? '📁' : '📄';

            const label = document.createElement('span');
            label.className = 'tree-label';
            label.textContent = child.name;

            const barContainer = document.createElement('div');
            barContainer.className = 'tree-bar-container';
            const bar = document.createElement('div');
            bar.className = 'tree-bar';
            bar.style.width = Math.max(2, child.percent) + '%';
            bar.style.background = sizeShareColor(child.percent);
            barContainer.appendChild(bar);

            const meta = document.createElement('div');
            meta.className = 'tree-meta';
            const size = document.createElement('span');
            size.className = 'tree-size';
            size.textContent = child.size_human;
            const pct = document.createElement('span');
            pct.className = 'tree-percent';
            pct.textContent = child.percent.toFixed(1) + '%';
            meta.appendChild(size);
            meta.appendChild(pct);

            node.appendChild(chevron);
            node.appendChild(icon);
            node.appendChild(label);
            node.appendChild(barContainer);
            node.appendChild(meta);

            // Chevron click: toggle expand
            chevron.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!child.has_children) return;

                if (expandedPaths.has(child.path)) {
                    expandedPaths.delete(child.path);
                } else {
                    expandedPaths.add(child.path);
                    if (!treeCache[child.path]) {
                        await fetchTreeNode(child.path);
                    }
                }
                renderTree();
            });

            // Name click: navigate treemap
            node.addEventListener('click', () => {
                if (child.has_children) {
                    navigateTo(child.path);
                }
            });

            // Right-click: context menu
            node.addEventListener('contextmenu', (e) => {
                showContextMenu(e, {
                    path: child.path,
                    name: child.name,
                    size_human: child.size_human,
                    has_children: child.has_children
                });
            });

            treeContainer.appendChild(node);

            // Render expanded children
            if (child.has_children && expandedPaths.has(child.path) && treeCache[child.path]) {
                renderTreeChildren(treeCache[child.path], depth + 1);
            }
        });
    }

    // --- Context menu ---
    function showContextMenu(e, data) {
        e.preventDefault();
        ctxTarget = data;
        contextMenu.style.display = 'block';
        contextMenu.style.left = e.clientX + 'px';
        contextMenu.style.top = e.clientY + 'px';
        // Keep in viewport
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
        // Only show custom menu on our elements, not default
        if (!e.target.closest('.tree-node') && !e.target.closest('.list-item') && !e.target.closest('.smart-item')) {
            hideContextMenu();
        }
    });

    $('ctxCopyPath').addEventListener('click', () => {
        if (ctxTarget) {
            navigator.clipboard.writeText(ctxTarget.path).catch(() => {});
        }
    });

    $('ctxOpenExplorer').addEventListener('click', () => {
        if (ctxTarget) {
            fetch('/api/open?path=' + encodeURIComponent(ctxTarget.path));
        }
    });

    $('ctxInfo').addEventListener('click', () => {
        if (ctxTarget) {
            alert(`Name: ${ctxTarget.name}\nPath: ${ctxTarget.path}\nSize: ${ctxTarget.size_human}\nType: ${ctxTarget.has_children ? 'Directory' : 'File'}`);
        }
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
                smartList.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center">No cleanup suggestions found</div>';
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
                const name = document.createElement('div');
                name.className = 'smart-name';
                name.textContent = item.name;
                const path = document.createElement('div');
                path.className = 'smart-path';
                path.textContent = item.path;
                const desc = document.createElement('div');
                desc.className = 'smart-desc';
                desc.textContent = item.description + ' · ' + formatNum(item.file_count) + ' files';
                info.appendChild(name);
                info.appendChild(path);
                info.appendChild(desc);

                const size = document.createElement('span');
                size.className = 'smart-size';
                size.textContent = item.size_human;

                el.appendChild(badge);
                el.appendChild(info);
                el.appendChild(size);

                // Click navigates to that path in explorer
                el.addEventListener('click', () => {
                    smartOverlay.classList.remove('open');
                    navigateTo(item.path);
                });

                // Right-click context menu
                el.addEventListener('contextmenu', (e) => {
                    showContextMenu(e, {
                        path: item.path,
                        name: item.name,
                        size_human: item.size_human,
                        has_children: true
                    });
                });

                smartList.appendChild(el);
            });
        } catch (e) {
            smartList.innerHTML = '<div style="padding:20px;color:var(--accent-red)">Failed to load</div>';
        }
    }

    smartBtn.addEventListener('click', openSmart);
    smartClose.addEventListener('click', () => smartOverlay.classList.remove('open'));
    smartOverlay.addEventListener('click', e => {
        if (e.target === smartOverlay) smartOverlay.classList.remove('open');
    });

    // --- Keyboard ---
    document.addEventListener('keydown', e => {
        // Close overlays
        if (e.key === 'Escape') {
            if (smartOverlay.classList.contains('open')) {
                smartOverlay.classList.remove('open');
                return;
            }
            if (shortcutsOverlay.classList.contains('open')) {
                shortcutsOverlay.classList.remove('open');
                return;
            }
            navigateUp();
            return;
        }

        if (e.key === '?') {
            shortcutsOverlay.classList.toggle('open');
            return;
        }

        // Don't capture when typing in input
        if (e.target.tagName === 'INPUT') return;

        if (e.key === 'Backspace') {
            navigateUp();
            e.preventDefault();
            return;
        }

        if (e.key === 'r' || e.key === 'R') {
            rescan();
            return;
        }

        if (e.key === 's' || e.key === 'S') {
            openSmart();
            return;
        }

        // Layout shortcuts
        if (e.key === '1') { setLayout('explorer'); return; }
        if (e.key === '2') { setLayout('classic'); return; }
        if (e.key === '3') { setLayout('list'); return; }

        if (!treeData || !treeData.children) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, treeData.children.length - 1);
            highlightSelected();
            scrollToSelected();
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            highlightSelected();
            scrollToSelected();
        }

        if (e.key === 'Enter' && selectedIndex >= 0) {
            const child = treeData.children[selectedIndex];
            if (child && child.has_children) {
                navigateTo(child.path);
            }
        }
    });

    function scrollToSelected() {
        const items = listContainer.querySelectorAll('.list-item');
        if (items[selectedIndex]) {
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // --- Rescan ---
    function rescan() {
        if (!rootPath) return;
        startScan(rootPath);
    }

    rescanBtn.onclick = rescan;

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

    shortcutHint.onclick = () => shortcutsOverlay.classList.toggle('open');
    shortcutsOverlay.onclick = e => {
        if (e.target === shortcutsOverlay) shortcutsOverlay.classList.remove('open');
    };

    // --- Auto-start: check if server already has a scan ---
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
                    mainContent.style.display = 'flex';
                    breadcrumbBar.style.display = 'flex';
                    bottomBar.style.display = 'flex';

                    updateStatus(data);
                    connectSSE();
                    fetchTree(currentPath);
                    return;
                }
            }
        } catch (e) {}
        // Show landing
        landing.style.display = 'flex';
    }

    init();
})();
