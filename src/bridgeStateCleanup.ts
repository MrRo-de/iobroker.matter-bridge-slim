export const ORPHAN_BRIDGE_STATE_KEYS = [
    "status",
    "pairingQr",
    "pairingManualCode",
    "commissioned",
    "fabricCount",
] as const;

const knownKeys = new Set<string>(ORPHAN_BRIDGE_STATE_KEYS);

export function findOrphanedBridgeIds(
    rows: readonly { id?: string }[],
    namespace: string,
    configuredBridgeIds: ReadonlySet<string>,
): string[] {
    const orphanIds = new Set<string>();

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
