/**
 * Dashboard Notifier
 * Sends real-time events to the dashboard WebSocket server
 */

const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 3000;
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || 'localhost';

let _ws = null;
let _reconnectTimer = null;
let _eventQueue = [];

function getWsUrl() {
    return `ws://${DASHBOARD_HOST}:${DASHBOARD_PORT}`;
}

function connect() {
    if (_ws && _ws.readyState === 1) return;
    
    try {
        _ws = new (require('ws'))(getWsUrl());
        
        _ws.on('open', () => {
            console.log('[Dashboard] Connected');
            flushQueue();
        });
        
        _ws.on('close', () => {
            console.log('[Dashboard] Disconnected, reconnecting in 5s...');
            _ws = null;
            _reconnectTimer = setTimeout(connect, 5000);
        });
        
        _ws.on('error', (err) => {
            // Silently ignore connection errors - dashboard is optional
        });
        
        _ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'pong') {
                    // Heartbeat acknowledged
                }
            } catch {}
        });
        
    } catch (e) {
        // ws module not available or connection failed - that's ok
        _reconnectTimer = setTimeout(connect, 10000);
    }
}

function send(type, data) {
    const event = {
        type,
        data,
        timestamp: new Date().toISOString()
    };
    
    if (_ws && _ws.readyState === 1) {
        _ws.send(JSON.stringify(event));
    } else {
        _eventQueue.push(event);
    }
    
    // Also save to state.json for persistence
    saveEventToState(type, data);
}

function flushQueue() {
    while (_eventQueue.length > 0 && _ws && _ws.readyState === 1) {
        const event = _eventQueue.shift();
        _ws.send(JSON.stringify(event));
    }
}

function saveEventToState(type, data) {
    try {
        const fs = require('fs');
        const path = require('path');
        const statePath = path.join(process.cwd(), 'state.json');
        
        let state = {};
        if (fs.existsSync(statePath)) {
            state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        }
        
        if (!state.recentEvents) state.recentEvents = [];
        
        state.recentEvents.unshift({
            type,
            data,
            timestamp: new Date().toISOString()
        });
        
        // Keep last 100 events
        state.recentEvents = state.recentEvents.slice(0, 100);
        state.lastUpdated = new Date().toISOString();
        
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (e) {
        // Ignore errors - this is best-effort
    }
}

// Public API
export function notifyDeploy(position) {
    send('deploy', {
        message: `Deployed to ${position.pool_name || position.pair || 'new pool'}`,
        pool_name: position.pool_name,
        pool: position.pool,
        position: position.position,
        amount_sol: position.amount_sol,
        strategy: position.strategy,
        bin_range: position.bin_range
    });
}

export function notifyClose(position, result) {
    send('close', {
        message: `Closed ${position.pool_name || position.pair || 'position'}`,
        pool_name: position.pool_name,
        pool: position.pool,
        position: position.position,
        pnl_usd: result.pnl_usd,
        pnl_pct: result.pnl_pct,
        fees_earned_usd: result.fees_earned_usd,
        close_reason: result.close_reason,
        strategy: position.strategy
    });
}

export function notifyOOR(position) {
    send('oor', {
        message: `${position.pair || 'Position'} is out of range!`,
        pair: position.pair,
        pool: position.pool,
        position: position.position,
        active_bin: position.active_bin,
        upper_bin: position.upper_bin,
        lower_bin: position.lower_bin,
        minutes_out_of_range: position.minutes_out_of_range
    });
}

export function notifySwap(data) {
    send('swap', {
        message: `Swapped ${data.fromAmount} ${data.fromToken} for ${data.toAmount} ${data.toToken}`,
        ...data
    });
}

export function notifyLesson(lesson) {
    send('lesson_added', {
        message: `New lesson: ${lesson.rule?.slice(0, 50)}...`,
        rule: lesson.rule,
        outcome: lesson.outcome,
        tags: lesson.tags
    });
}

export function notifyPositionUpdate(position) {
    send('position_updated', {
        pair: position.pair,
        pool: position.pool,
        position: position.position,
        pnl_usd: position.pnl_usd,
        pnl_pct: position.pnl_pct,
        in_range: position.in_range,
        unclaimed_fees_usd: position.unclaimed_fees_usd,
        message: `${position.pair} updated: ${position.in_range ? 'In Range' : 'OOR'} | PnL: $${position.pnl_usd}`
    });
}

export function init() {
    // Try to connect on startup
    connect();
    
    // Keep trying to connect
    if (!_reconnectTimer) {
        _reconnectTimer = setTimeout(connect, 5000);
    }
    
    console.log('[Dashboard] Notifier initialized');
}

export function isConnected() {
    return _ws && _ws.readyState === 1;
}
