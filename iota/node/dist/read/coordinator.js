"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IotaCoordinatorReader = exports.CoordinatorReadError = void 0;
exports.classifyCoordinatorReadError = classifyCoordinatorReadError;
class CoordinatorReadError extends Error {
    constructor(code, message, retryable) {
        super(message);
        this.name = 'CoordinatorReadError';
        this.code = code;
        this.retryable = retryable;
    }
}
exports.CoordinatorReadError = CoordinatorReadError;
function normalizeHex(value, name) {
    const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
        throw new CoordinatorReadError('invalid_view_value', `${name} is not a valid hex string.`, false);
    }
    return normalized;
}
function normalizeByteArray(value, name) {
    if (typeof value === 'string') {
        return normalizeHex(value, name);
    }
    if (Array.isArray(value) &&
        value.every((item) => (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 255) ||
            (typeof item === 'string' && /^\d+$/.test(item)))) {
        return value
            .map((item) => Number(item).toString(16).padStart(2, '0'))
            .join('');
    }
    throw new CoordinatorReadError('invalid_view_value', `${name} is not a byte vector.`, false);
}
function normalizeU8(value, name) {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d+$/.test(value)
            ? Number.parseInt(value, 10)
            : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
        throw new CoordinatorReadError('invalid_view_value', `${name} is not a valid u8 value.`, false);
    }
    return parsed;
}
function parseFunctionReturnValue(result, functionName) {
    if (!result || typeof result !== 'object') {
        throw new CoordinatorReadError('invalid_view_response', `View call ${functionName} returned an invalid response.`, false);
    }
    if ('executionError' in result) {
        const message = String(result.executionError ?? 'unknown view error');
        throw classifyCoordinatorReadError(message);
    }
    if (!('functionReturnValues' in result)) {
        throw new CoordinatorReadError('invalid_view_response', `View call ${functionName} did not include functionReturnValues.`, false);
    }
    const values = result.functionReturnValues ?? [];
    if (values.length === 0) {
        throw new CoordinatorReadError('invalid_view_response', `View call ${functionName} returned no values.`, false);
    }
    return values[0] ?? null;
}
function classifyCoordinatorReadError(error) {
    if (error instanceof CoordinatorReadError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (normalized.includes('view function calls not supported') ||
        normalized.includes('unsupported feature')) {
        return new CoordinatorReadError('view_unsupported', message, false);
    }
    if (normalized.includes('e_request_not_pending') ||
        /\babort code\b[^0-9]*(7)\b/.test(normalized) ||
        /\bmoveabort\b[^0-9]*(7)\b/.test(normalized) ||
        normalized.includes('dynamic field not found') ||
        normalized.includes('field does not exist')) {
        return new CoordinatorReadError('request_missing', message, false);
    }
    if (normalized.includes('network') || normalized.includes('timeout') || normalized.includes('rpc')) {
        return new CoordinatorReadError('view_unavailable', message, true);
    }
    return new CoordinatorReadError('view_failed', message, true);
}
class IotaCoordinatorReader {
    constructor(client, coordinatorPackageId, coordinatorObjectId) {
        this.client = client;
        this.coordinatorPackageId = coordinatorPackageId;
        this.coordinatorObjectId = coordinatorObjectId;
        this.requestsTableObjectId = null;
    }
    async getActiveVrfPublicKey() {
        if (typeof this.client.getObject === 'function') {
            const fields = await this.getCoordinatorFields();
            return normalizeByteArray(fields.vrf_public_key, 'vrf_public_key');
        }
        const value = await this.view('vrf_public_key', [this.coordinatorObjectId]);
        return normalizeByteArray(value, 'vrf_public_key');
    }
    async getRequestStatus(requestId) {
        if (typeof this.client.getDynamicFieldObject === 'function') {
            try {
                const value = await this.readRequestStatusFromDynamicField(requestId);
                const status = normalizeU8(value, 'request_status');
                switch (status) {
                    case 0:
                        return 'pending';
                    case 1:
                        return 'fulfilled';
                    case 2:
                        return 'cancelled';
                    default:
                        throw new CoordinatorReadError('invalid_view_value', `request_status returned unsupported status ${status}.`, false);
                }
            }
            catch (error) {
                const classified = classifyCoordinatorReadError(error);
                if (classified.code === 'request_missing') {
                    return 'missing';
                }
                throw classified;
            }
        }
        try {
            const value = await this.view('request_status', [this.coordinatorObjectId, requestId]);
            const status = normalizeU8(value, 'request_status');
            switch (status) {
                case 0:
                    return 'pending';
                case 1:
                    return 'fulfilled';
                case 2:
                    return 'cancelled';
                default:
                    throw new CoordinatorReadError('invalid_view_value', `request_status returned unsupported status ${status}.`, false);
            }
        }
        catch (error) {
            const classified = classifyCoordinatorReadError(error);
            if (classified.code === 'request_missing') {
                return 'missing';
            }
            throw classified;
        }
    }
    async view(functionName, args) {
        if (typeof this.client.view !== 'function') {
            throw new CoordinatorReadError('view_unavailable', `Client does not support view calls for ${functionName}.`, true);
        }
        try {
            const result = await this.client.view({
                functionName: `${this.coordinatorPackageId}::coordinator::${functionName}`,
                arguments: args,
            });
            return parseFunctionReturnValue(result, functionName);
        }
        catch (error) {
            throw classifyCoordinatorReadError(error);
        }
    }
    async getCoordinatorFields() {
        if (typeof this.client.getObject !== 'function') {
            throw new CoordinatorReadError('object_unavailable', 'Client does not support object reads.', true);
        }
        try {
            const response = await this.client.getObject({
                id: this.coordinatorObjectId,
                options: { showContent: true },
            });
            const data = extractObjectData(response, 'coordinator');
            const content = data.content;
            if (!content || typeof content !== 'object' || !('fields' in content)) {
                throw new CoordinatorReadError('invalid_object_response', 'Coordinator object response did not include Move content fields.', false);
            }
            const fields = content.fields;
            if (!fields || typeof fields !== 'object') {
                throw new CoordinatorReadError('invalid_object_response', 'Coordinator object content fields were missing.', false);
            }
            return fields;
        }
        catch (error) {
            throw classifyCoordinatorReadError(error);
        }
    }
    async getRequestsTableObjectId() {
        if (this.requestsTableObjectId) {
            return this.requestsTableObjectId;
        }
        const fields = await this.getCoordinatorFields();
        const requests = fields.requests;
        if (!requests || typeof requests !== 'object') {
            throw new CoordinatorReadError('invalid_object_response', 'Coordinator object did not include requests table metadata.', false);
        }
        const requestTableId = nestedString(requests, ['fields', 'id', 'id'], 'requests table object id');
        this.requestsTableObjectId = requestTableId.toLowerCase();
        return this.requestsTableObjectId;
    }
    async readRequestStatusFromDynamicField(requestId) {
        if (typeof this.client.getDynamicFieldObject !== 'function') {
            throw new CoordinatorReadError('dynamic_field_unavailable', 'Client does not support dynamic field reads.', true);
        }
        const parentObjectId = await this.getRequestsTableObjectId();
        try {
            const response = await this.client.getDynamicFieldObject({
                parentObjectId,
                name: {
                    type: 'u64',
                    value: requestId,
                },
                options: { showContent: true },
            });
            const data = extractObjectData(response, 'request record');
            const content = data.content;
            if (!content || typeof content !== 'object' || !('fields' in content)) {
                throw new CoordinatorReadError('invalid_object_response', `Dynamic field response for request ${requestId} did not include Move content fields.`, false);
            }
            const fields = content.fields;
            if (!fields || typeof fields !== 'object') {
                throw new CoordinatorReadError('invalid_object_response', `Dynamic field response for request ${requestId} did not include content fields.`, false);
            }
            if ('status' in fields) {
                return fields.status;
            }
            const nestedValue = nestedUnknown(fields, ['value', 'fields', 'status']);
            if (nestedValue !== undefined) {
                return nestedValue;
            }
            throw new CoordinatorReadError('invalid_object_response', `Dynamic field response for request ${requestId} did not include status.`, false);
        }
        catch (error) {
            throw classifyCoordinatorReadError(error);
        }
    }
}
exports.IotaCoordinatorReader = IotaCoordinatorReader;
function extractObjectData(response, name) {
    if (!response || typeof response !== 'object') {
        throw new CoordinatorReadError('invalid_object_response', `${name} response was not an object.`, false);
    }
    if ('error' in response) {
        throw classifyCoordinatorReadError(String(response.error ?? `${name} read failed`));
    }
    const envelope = response;
    const data = envelope.data && typeof envelope.data === 'object'
        ? envelope.data
        : response;
    if (!data || typeof data !== 'object') {
        throw new CoordinatorReadError('invalid_object_response', `${name} response did not include object data.`, false);
    }
    return data;
}
function nestedUnknown(value, path) {
    let current = value;
    for (const segment of path) {
        if (!current || typeof current !== 'object' || !(segment in current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function nestedString(value, path, name) {
    const result = nestedUnknown(value, path);
    if (typeof result !== 'string' || result.trim() === '') {
        throw new CoordinatorReadError('invalid_object_response', `${name} was missing from the object response.`, false);
    }
    return result;
}
