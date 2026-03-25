import "dotenv/config";
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { URL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
};

const clients = new Set();

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function broadcast(data, type = 'update') {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    clients.forEach(client => {
        try {
            if (client.readyState === 1) {
                client.send(message);
            }
        } catch (e) {
            clients.delete(client);
        }
    });
}

async function fetchCandidates() {
    try {
        const url = `${POOL_DISCOVERY_BASE}/pools?page_size=15&timeframe=5m&category=trending`;
        const res = await fetch(url);
        if (!res.ok) return { candidates: [], total: 0, error: `API error: ${res.status}` };
        
        const data = await res.json();
        const rawPools = data.data || [];
        
        const pools = rawPools.map(p => {
            const tokenX = p.token_x || {};
            const tokenY = p.token_y || {};
            const baseSymbol = tokenX.symbol || 'UNKNOWN';
            const quoteSymbol = tokenY.symbol || 'SOL';
            const binStep = p.dlmm_params?.bin_step || 0;
            
            return {
                name: `${baseSymbol}/${quoteSymbol}`,
                pool: p.pool_address,
                bin_step: binStep,
                fee_pct: p.fee_pct || 0,
                volume_24h: p.volume || 0,
                volume_change: p.volume_change_pct || 0,
                tvl: p.tvl || 0,
                tvl_change: p.tvl_change_pct || 0,
                organic_score: tokenX.organic_score || 0,
                market_cap: tokenX.market_cap || 0,
                holders: tokenX.holders || 0,
                top_holders_pct: tokenX.top_holders_pct || 0,
                base_mint: tokenX.address,
                base_symbol: baseSymbol,
                quote_symbol: quoteSymbol,
                price: tokenX.price || 0,
                price_change_24h: p.base_token_market_cap_change_pct || 0,
                pool_type: p.pool_type || 'dlmm',
                fee_tvl_ratio: p.fee_active_tvl_ratio || 0,
                volatility: p.volatility || 0,
                risk_flags: tokenX.warnings?.map(w => w.type) || [],
            };
        });

        return { candidates: pools, total: data.total || pools.length };
    } catch (e) {
        return { candidates: [], total: 0, error: e.message };
    }
}

async function fetchWalletData() {
    try {
        const walletPath = path.join(__dirname, '..', 'tools', 'wallet.js');
        if (!fs.existsSync(walletPath)) {
            return { error: 'Wallet module not found' };
        }
        const { getWalletBalances } = await import(`file://${walletPath.replace(/\\/g, '/')}`);
        return await getWalletBalances();
    } catch (e) {
        return { error: e.message };
    }
}

async function fetchOpenPositions() {
    try {
        const dlmmPath = path.join(__dirname, '..', 'tools', 'dlmm.js');
        if (!fs.existsSync(dlmmPath)) {
            return { positions: [], error: 'DLMM module not found' };
        }
        
        const { getMyPositions, getPositionPnl } = await import(`file://${dlmmPath.replace(/\\/g, '/')}`);
        const result = await getMyPositions({ force: true });
        
        const statePath = path.join(__dirname, '..', 'state.json');
        let stateData = {};
        if (fs.existsSync(statePath)) {
            stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }
        
        if (result.positions && result.positions.length > 0) {
            const enriched = await Promise.all(result.positions.map(async (p) => {
                const statePos = stateData.positions?.[p.position];
                if (statePos?.pool_name) {
                    p.pool_name = statePos.pool_name;
                }
                
                try {
                    const pnl = await getPositionPnl({ pool_address: p.pool, position_address: p.position });
                    return { ...p, pnl };
                } catch {
                    return p;
                }
            }));
            result.positions = enriched;
        }
        
        return result;
    } catch (e) {
        return { positions: [], error: e.message };
    }
}

function loadJsonFile(filename) {
    try {
        const filePath = path.join(__dirname, '..', filename);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {}
    return null;
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200, corsHeaders());
        res.end();
        return;
    }

    if (url.pathname === '/api/candidates') {
        const data = await fetchCandidates();
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/wallet') {
        const data = await fetchWalletData();
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/positions') {
        const data = await fetchOpenPositions();
        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/alldata') {
        const [state, lessons, poolMemory, candidates, wallet, positions] = await Promise.all([
            Promise.resolve(loadJsonFile('state.json')),
            Promise.resolve(loadJsonFile('lessons.json')),
            Promise.resolve(loadJsonFile('pool-memory.json')),
            fetchCandidates(),
            fetchWalletData(),
            fetchOpenPositions()
        ]);

        const data = {
            performance: state?.performance || [],
            lessons: lessons?.lessons || [],
            pools: poolMemory || {},
            candidates: candidates.candidates || [],
            wallet: wallet,
            positions: positions.positions || [],
            lastUpdated: new Date().toISOString()
        };

        res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify(data));
        return;
    }

    if (url.pathname === '/api/event') {
        const type = url.searchParams.get('type');
        const dataStr = url.searchParams.get('data');
        
        if (type && dataStr) {
            try {
                const eventData = JSON.parse(decodeURIComponent(dataStr));
                const event = { type, data: eventData, timestamp: new Date().toISOString() };
                
                const statePath = path.join(__dirname, '..', 'state.json');
                try {
                    let state = {};
                    if (fs.existsSync(statePath)) {
                        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
                    }
                    if (!state.recentEvents) state.recentEvents = [];
                    state.recentEvents.unshift(event);
                    state.recentEvents = state.recentEvents.slice(0, 100);
                    state.lastUpdated = event.timestamp;
                    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
                } catch (e) {}
                
                broadcast(event, type);
                res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
                res.end(JSON.stringify({ error: 'Invalid data' }));
            }
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json', ...corsHeaders() });
            res.end(JSON.stringify({ error: 'Missing type or data' }));
        }
        return;
    }

    let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    filePath = path.join(__dirname, filePath);
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    if (filePath.includes('..')) {
        res.writeHead(403, corsHeaders());
        res.end('Forbidden');
        return;
    }

    try {
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': contentType, ...corsHeaders() });
        res.end(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            const jsonFile = path.join(__dirname, '..', url.pathname);
            try {
                const data = fs.readFileSync(jsonFile);
                res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders() });
                res.end(data);
            } catch {
                res.writeHead(404, corsHeaders());
                res.end('Not Found: ' + url.pathname);
            }
        } else {
            res.writeHead(500, corsHeaders());
            res.end('Server Error');
        }
    }
});

import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('[WS] Dashboard client connected');
    clients.add(ws);

    ws.on('message', (message) => {
        try {
            const msg = JSON.parse(message.toString());
            if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log('[WS] Dashboard client disconnected');
    });

    ws.on('error', (err) => {
        clients.delete(ws);
    });
});

setInterval(async () => {
    if (clients.size > 0) {
        try {
            const [wallet, positions] = await Promise.all([
                fetchWalletData(),
                fetchOpenPositions()
            ]);
            broadcast({ wallet, positions }, 'heartbeat');
        } catch (e) {}
    }
}, 15000);

server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚀 Meridian DLMM Dashboard (Real-time)                  ║
║                                                          ║
║   Local:    http://localhost:${PORT}                        ║
║   Network:  http://${getLocalIP()}:${PORT}                    ║
║                                                          ║
║   Open on your phone:                                    ║
║   1. Connect to same WiFi                                 ║
║   2. Go to http://<your-local-ip>:${PORT}                   ║
║                                                          ║
║   Press Ctrl+C to stop                                   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
    `);
});

function getLocalIP() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    wss.close();
    server.close();
    process.exit();
});
