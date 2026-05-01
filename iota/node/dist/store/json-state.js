"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonStateStore = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
function cloneCursor(cursor) {
    return cursor ? { ...cursor } : null;
}
function cloneRequest(request) {
    return {
        ...request,
        cursor: { ...request.cursor },
    };
}
function cloneRecord(record) {
    return {
        ...record,
        request: cloneRequest(record.request),
    };
}
class JsonStateStore {
    constructor(stateDir) {
        this.stateDir = stateDir;
        this.cursor = null;
        this.requests = {};
    }
    async initialize() {
        await fs.mkdir(this.stateDir, { recursive: true });
        this.cursor = await this.readCursorFile();
        this.requests = await this.readRequestsFile();
    }
    getCursor() {
        return cloneCursor(this.cursor);
    }
    getRequest(requestId) {
        const record = this.requests[requestId];
        return record ? cloneRecord(record) : undefined;
    }
    listDueRetries(now = new Date()) {
        const threshold = now.getTime();
        return Object.values(this.requests)
            .filter((record) => record.status === 'retry' &&
            record.nextRetryAt !== null &&
            Date.parse(record.nextRetryAt) <= threshold)
            .map(cloneRecord)
            .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    }
    async saveCursor(cursor) {
        this.cursor = cloneCursor(cursor);
        await this.atomicWrite(this.cursorFilePath, JSON.stringify({ cursor: this.cursor }, null, 2));
    }
    async markRetry(request, previousAttempts, error, nextRetryAt) {
        this.requests[request.requestId] = {
            request: cloneRequest(request),
            status: 'retry',
            attempts: previousAttempts + 1,
            updatedAt: new Date().toISOString(),
            nextRetryAt,
            lastError: error,
            txDigest: null,
        };
        await this.persistRequests();
    }
    async markFulfilled(request, attempts, txDigest) {
        this.requests[request.requestId] = {
            request: cloneRequest(request),
            status: 'fulfilled',
            attempts,
            updatedAt: new Date().toISOString(),
            nextRetryAt: null,
            lastError: null,
            txDigest,
        };
        await this.persistRequests();
    }
    async markTerminal(request, attempts, error) {
        this.requests[request.requestId] = {
            request: cloneRequest(request),
            status: 'terminal',
            attempts,
            updatedAt: new Date().toISOString(),
            nextRetryAt: null,
            lastError: error,
            txDigest: null,
        };
        await this.persistRequests();
    }
    get cursorFilePath() {
        return path.join(this.stateDir, 'cursor.json');
    }
    get requestsFilePath() {
        return path.join(this.stateDir, 'requests.json');
    }
    async readCursorFile() {
        try {
            const payload = JSON.parse(await fs.readFile(this.cursorFilePath, 'utf8'));
            return payload.cursor ? { ...payload.cursor } : null;
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }
            throw error;
        }
    }
    async readRequestsFile() {
        try {
            const payload = JSON.parse(await fs.readFile(this.requestsFilePath, 'utf8'));
            return Object.fromEntries(Object.entries(payload.requests ?? {}).map(([requestId, record]) => [requestId, cloneRecord(record)]));
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return {};
            }
            throw error;
        }
    }
    async persistRequests() {
        await this.atomicWrite(this.requestsFilePath, JSON.stringify({ requests: this.requests }, null, 2));
    }
    async atomicWrite(filePath, contents) {
        const tempPath = `${filePath}.${process.pid}.tmp`;
        const handle = await fs.open(tempPath, 'w');
        try {
            await handle.writeFile(contents, 'utf8');
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await fs.rename(tempPath, filePath);
        await this.syncParentDirectory(filePath);
    }
    async syncParentDirectory(filePath) {
        const directoryHandle = await fs.open(path.dirname(filePath), 'r');
        try {
            await directoryHandle.sync();
        }
        finally {
            await directoryHandle.close();
        }
    }
}
exports.JsonStateStore = JsonStateStore;
