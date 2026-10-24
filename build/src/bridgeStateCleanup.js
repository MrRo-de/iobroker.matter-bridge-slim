"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORPHAN_BRIDGE_STATE_KEYS = void 0;
exports.findOrphanedBridgeIds = findOrphanedBridgeIds;
exports.ORPHAN_BRIDGE_STATE_KEYS = [
    "status",
    "pairingQr",
    "pairingManualCode",
    "commissioned",
    "fabricCount",
];
const knownKeys = new Set(exports.ORPHAN_BRIDGE_STATE_KEYS);
function findOrphanedBridgeIds(rows, namespace, configuredBridgeIds) {
    const orphanIds = new Set();
    for (const row of rows) {
        if (typeof row.id !== "string") {
            continue;
        }
        const localId = row.id.startsWith(`${namespace}.`)
            ? row.id.slice(namespace.length + 1)
            : row.id;
        const match = /^bridges\.([^.]+)\.([^.]+)$/.exec(localId);
        if (!match || !knownKeys.has(match[2])) {
            continue;
        }
        if (!configuredBridgeIds.has(match[1])) {
            orphanIds.add(match[1]);
        }
    }
    return [...orphanIds].sort();
}
//# sourceMappingURL=bridgeStateCleanup.js.map