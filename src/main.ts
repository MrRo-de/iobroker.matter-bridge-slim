import { findOrphanedBridgeIds, ORPHAN_BRIDGE_STATE_KEYS } from "./bridgeStateCleanup.js";
import { Adapter, type AdapterOptions } from "@iobroker/adapter-core";
import { Endpoint, ServerNode, VendorId } from "@matter/main";
import { CommissioningServer } from "@matter/node/behaviors/system/commissioning";
import { OperationalCredentialsBehavior } from "@matter/node/behaviors/operational-credentials";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors/bridged-device-basic-information";
import { OnOffServer } from "@matter/main/behaviors/on-off";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import { DimmableLightDevice } from "@matter/main/devices/dimmable-light";
import { LevelControlServer } from "@matter/main/behaviors/level-control";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import { TemperatureSensorDevice } from "@matter/main/devices/temperature-sensor";
import { HumiditySensorDevice } from "@matter/main/devices/humidity-sensor";
import { TemperatureMeasurementServer } from "@matter/main/behaviors/temperature-measurement";
import { RelativeHumidityMeasurementServer } from "@matter/main/behaviors/relative-humidity-measurement";
import { DEVICE_TYPE_REGISTRY, isDeviceType, type DeviceType } from "../shared/device-registry.js";

interface BridgeConfig {
    id: string;
    name: string;
    port: number;
}

interface DeviceConfig {
    id: string;
    bridgeId: string;
    name: string;
    stateId: string;
    type: DeviceType;
    brightnessStateId?: string;
}

interface MatterBridgeConfig {
    bridges?: unknown;
    devices?: unknown;
}

interface NormalizedConfig {
    bridges: BridgeConfig[];
    devices: DeviceConfig[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isPercentage(value: unknown): value is number {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100;
}

function isTemperature(value: unknown): value is number {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= -273.15 &&
        value <= 327.67;
}

function temperatureToMatter(value: number): number {
    return Math.round(value * 100);
}

function humidityToMatter(value: number): number {
    return Math.round(value * 100);
}

function percentageToMatterLevel(value: number): number {
    // Matter CurrentLevel: 1–254; 0 % wird über On/Off abgebildet.
    return Math.max(1, Math.min(254, Math.round(value * 254 / 100)));
}

function matterLevelToPercentage(value: number): number {
    // Matter-Level 1–254 entspricht mindestens 1 %; 0 % wird über On/Off abgebildet.
    return Math.max(1, Math.min(100, Math.round(value * 100 / 254)));
}

function normalizeConfig(raw: MatterBridgeConfig): NormalizedConfig {
    const errors: string[] = [];
    const bridges: BridgeConfig[] = [];
    const devices: DeviceConfig[] = [];

    const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
    const rawDevices = Array.isArray(raw.devices) ? raw.devices : [];

    const bridgeIds = new Set<string>();
    const ports = new Set<number>();
    const deviceIds = new Set<string>();
    const stateIds = new Set<string>();

    for (const [index, item] of rawBridges.entries()) {
        if (!isRecord(item)) {
            errors.push(`Bridge ${index + 1}: ungültiger Eintrag.`);
            continue;
        }

        const { id, name, port } = item;

        if (!nonEmptyString(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            errors.push(`Bridge ${index + 1}: ID fehlt oder enthält ungültige Zeichen.`);
            continue;
        }
        if (!nonEmptyString(name)) {
            errors.push(`Bridge "${id}": Name fehlt.`);
            continue;
        }
        if (
            typeof port !== "number" ||
            !Number.isInteger(port) ||
            port < 5540 ||
            port > 65535
        ) {
            errors.push(`Bridge "${id}": Port muss eine ganze Zahl zwischen 5540 und 65535 sein.`);
            continue;
        }
        if (bridgeIds.has(id)) {
            errors.push(`Bridge-ID "${id}" ist mehrfach vergeben.`);
            continue;
        }
        if (ports.has(port)) {
            errors.push(`Matter-Port ${port} ist mehrfach vergeben.`);
            continue;
        }

        bridgeIds.add(id);
        ports.add(port);
        bridges.push({ id, name: name.trim(), port });
    }

    for (const [index, item] of rawDevices.entries()) {
        if (!isRecord(item)) {
            errors.push(`Gerät ${index + 1}: ungültiger Eintrag.`);
            continue;
        }

        const { id, bridgeId, name, stateId } = item;
        const type = item.type === undefined ? "switch" : item.type;

        if (!nonEmptyString(id) || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            errors.push(`Gerät ${index + 1}: ID fehlt oder enthält ungültige Zeichen.`);
            continue;
        }
        if (!nonEmptyString(bridgeId) || !bridgeIds.has(bridgeId)) {
            errors.push(`Gerät "${id}": zugehörige Bridge existiert nicht.`);
            continue;
        }
        if (!nonEmptyString(name)) {
            errors.push(`Gerät "${id}": Name fehlt.`);
            continue;
        }
        if (
            !nonEmptyString(stateId) ||
            stateId.trim() !== stateId ||
            /\s/.test(stateId) ||
            !stateId.includes(".")
        ) {
            errors.push(`Gerät "${id}": ungültige ioBroker-State-ID.`);
            continue;
        }
        if (!isDeviceType(type)) {
            errors.push(
                `Gerät "${id}": ungültiger Gerätetyp "${String(type)}". ` +
                "Bitte einen in der Geräte-Registry definierten Typ verwenden.",
            );
            continue;
        }
        const configuredAdditionalStateIds: Record<string, string> = {};
        let additionalFieldsInvalid = false;

        const selectedFields = DEVICE_TYPE_REGISTRY[type].additionalStateFields;
        const allAdditionalFields = Object.values(DEVICE_TYPE_REGISTRY)
            .flatMap((definition) => definition.additionalStateFields);

        for (const field of selectedFields) {
            const value = item[field.key];

            if (value === undefined || value === "") {
                if (field.required) {
                    errors.push(
                        `Gerät "${id}": das Zusatzfeld "${field.key}" ist erforderlich.`,
                    );
                    additionalFieldsInvalid = true;
                }
                continue;
            }

            if (
                !nonEmptyString(value) ||
                value.trim() !== value ||
                /\\s/.test(value) ||
                !value.includes(".")
            ) {
                errors.push(
                    `Gerät "${id}": ungültige State-ID im Zusatzfeld "${field.key}".`,
                );
                additionalFieldsInvalid = true;
                continue;
            }

            if (
                value === stateId ||
                stateIds.has(value) ||
                Object.values(configuredAdditionalStateIds).includes(value)
            ) {
                errors.push(
                    `Gerät "${id}": ein ioBroker-State ist bereits einem anderen Feld oder Matter-Gerät zugeordnet.`,
                );
                additionalFieldsInvalid = true;
                continue;
            }

            configuredAdditionalStateIds[field.key] = value;
        }

        const selectedFieldKeys = new Set(selectedFields.map((field) => field.key));
        for (const field of allAdditionalFields) {
            if (selectedFieldKeys.has(field.key)) {
                continue;
            }

            const value = item[field.key];
            if (value !== undefined && value !== "") {
                errors.push(
                    `Gerät "${id}": das Zusatzfeld "${field.key}" ist für den Gerätetyp "${type}" nicht zulässig.`,
                );
                additionalFieldsInvalid = true;
            }
        }

        if (additionalFieldsInvalid) {
            continue;
        }

        if (stateIds.has(stateId)) {
            errors.push(`State "${stateId}" ist mehreren Matter-Geräten zugeordnet.`);
            continue;
        }
        if (deviceIds.has(`${bridgeId}:${id}`)) {
            errors.push(`Geräte-ID "${id}" ist in Bridge "${bridgeId}" mehrfach vergeben.`);
            continue;
        }
        if (stateIds.has(stateId)) {
            errors.push(`State "${stateId}" ist mehreren Matter-Geräten zugeordnet.`);
            continue;
        }

        deviceIds.add(`${bridgeId}:${id}`);
        stateIds.add(stateId);
        for (const additionalStateId of Object.values(configuredAdditionalStateIds)) {
            stateIds.add(additionalStateId);
        }
        devices.push({
            id,
            bridgeId,
            name: name.trim(),
            stateId,
            type,
            ...configuredAdditionalStateIds,
        });
    }

    if (errors.length > 0) {
        throw new Error(`Ungültige Matter-Konfiguration:\n- ${errors.join("\n- ")}`);
    }

    return { bridges, devices };
}

class MatterBridgeSlim extends Adapter {
    private readonly stateToEndpoint = new Map<
        string,
        { endpoint: Endpoint; kind: "onOff" | "brightness" | "temperature" | "humidity" }
    >();
    private readonly matterServers: ServerNode[] = [];
    private readonly matterServersById = new Map<string, ServerNode>();
    private readonly commissioningStateCleanup = new Map<string, () => void>();

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: "matter-bridge-slim",
        });

        this.on("ready", () => {
            void this.onReady();
        });

        this.on("stateChange", (id, state) => {
            if (!id || !state) {
                return;
            }

            const mapping = this.stateToEndpoint.get(id);
            if (!mapping) {
                return;
            }

            let update: Promise<unknown> | undefined;

            if (mapping.kind === "onOff" && typeof state.val === "boolean") {
                update = mapping.endpoint.setStateOf(OnOffServer, {
                    onOff: state.val,
                });
            } else if (mapping.kind === "brightness" && isPercentage(state.val)) {
                if (state.val === 0) {
                    // 0 % bedeutet ausgeschaltet; den letzten Matter-Level beibehalten.
                    update = mapping.endpoint.setStateOf(OnOffServer, {
                        onOff: false,
                    });
                } else {
                    // Eine positive Helligkeit schaltet ein und setzt den Level.
                    update = Promise.all([
                        mapping.endpoint.setStateOf(LevelControlServer, {
                            currentLevel: percentageToMatterLevel(state.val),
                        }),
                        mapping.endpoint.setStateOf(OnOffServer, {
                            onOff: true,
                        }),
                    ]);
                }
            } else if (mapping.kind === "temperature" && isTemperature(state.val)) {
                update = mapping.endpoint.setStateOf(TemperatureMeasurementServer, {
                    measuredValue: temperatureToMatter(state.val),
                });
            } else if (mapping.kind === "humidity" && isPercentage(state.val)) {
                update = mapping.endpoint.setStateOf(RelativeHumidityMeasurementServer, {
                    measuredValue: humidityToMatter(state.val),
                });
            }

            if (update) {
                void update.catch((error: unknown) => {
                    this.log.warn(
                        `Matter-Zustand für "${id}" konnte nicht aktualisiert werden: ${String(error)}`,
                    );
                });
            }
        });

        this.on("message", (obj) => {
            if (
                !obj ||
                (obj.command !== "reopenCommissioning" && obj.command !== "deleteBridge")
            ) {
                return;
            }

            if (!obj.callback) {
                this.log.warn(`${obj.command}: Kein Callback in der Nachricht.`);
                return;
            }

            const bridgeId = isRecord(obj.message) ? obj.message.bridgeId : undefined;
            if (!nonEmptyString(bridgeId)) {
                this.sendTo(
                    obj.from,
                    obj.command,
                    { ok: false, error: "Ungültige Bridge-ID." },
                    obj.callback,
                );
                return;
            }

            if (obj.command === "deleteBridge") {
                void (async () => {
                    try {
                        const server = this.matterServersById.get(bridgeId);
                        if (!server) {
                            throw new Error(`Bridge "${bridgeId}" ist nicht aktiv; Löschung abgebrochen.`);
                        }

                        if (this.matterServers.includes(server)) {
                            this.log.info(`deleteBridge: Stoppe Matter-Server "${bridgeId}".`);
                            await server.stop();

                            const serverIndex = this.matterServers.indexOf(server);
                            if (serverIndex >= 0) {
                                this.matterServers.splice(serverIndex, 1);
                            }
                        }

                        const cleanupCommissioning = this.commissioningStateCleanup.get(bridgeId);
                        if (cleanupCommissioning) {
                            cleanupCommissioning();
                            this.commissioningStateCleanup.delete(bridgeId);
                        }

                        this.log.info(`deleteBridge: Lösche persistente Matter-Daten für "${bridgeId}".`);
                        await server.erase();

                        for (const key of [
                            "status",
                            "pairingQr",
                            "pairingManualCode",
                            "commissioned",
                            "fabricCount",
                        ]) {
                            const id = `bridges.${bridgeId}.${key}`;
                            const object = await this.getObjectAsync(id);
                            if (object) {
                                await this.delObjectAsync(id);
                            }
                        }

                        this.matterServersById.delete(bridgeId);

                        this.log.info(`deleteBridge: Bridge "${bridgeId}" vollständig entfernt.`);
                        this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        try {
                            await this.setBridgeRuntimeState(bridgeId, "status", "error");
                        } catch (statusError) {
                            this.log.warn(
                                `Fehlerstatus für Bridge "${bridgeId}" konnte nicht geschrieben werden: ${String(statusError)}`,
                            );
                        }
                        this.log.error(`deleteBridge für "${bridgeId}" fehlgeschlagen: ${message}`);
                        this.sendTo(
                            obj.from,
                            obj.command,
                            { ok: false, error: message },
                            obj.callback,
                        );
                    }
                })();
                return;
            }

            const server = this.matterServersById.get(bridgeId);
            if (!server) {
                this.sendTo(
                    obj.from,
                    obj.command,
                    { ok: false, error: `Bridge "${bridgeId}" ist nicht aktiv.` },
                    obj.callback,
                );
                return;
            }

            void Promise.resolve(
                server.act(agent =>
                    agent.get(CommissioningServer).enterCommissionableMode(),
                ),
            )
                .then(() => {
                    this.log.info(
                        `Commissioning-Modus für Bridge "${bridgeId}" erneut geöffnet.`,
                    );
                    this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                })
                .catch((error: unknown) => {
                    const message = error instanceof Error ? error.message : String(error);
                    this.log.warn(
                        `Commissioning für Bridge "${bridgeId}" fehlgeschlagen: ${message}`,
                    );
                    this.sendTo(
                        obj.from,
                        obj.command,
                        { ok: false, error: message },
                        obj.callback,
                    );
                });
        });

        this.on("unload", (callback) => {
            for (const cleanup of this.commissioningStateCleanup.values()) {
                cleanup();
            }
            this.commissioningStateCleanup.clear();

            this.unsubscribeForeignStates("*", (error) => {
                if (error) {
                    this.log.debug(
                        `Abmelden der State-Abonnements: ${String(error)}`,
                    );
                }

                void Promise.allSettled(
                    this.matterServers.map((server) => server.stop()),
                ).then(() => callback());
            });
        });
    }

    private async cleanupOrphanedBridgeStates(
        bridges: Array<{ id: string }>,
    ): Promise<void> {
        const configuredIds = new Set(bridges.map(bridge => bridge.id));
        const prefix = `${this.namespace}.bridges.`;

        let result;
        try {
            result = await this.getObjectListAsync({
                startkey: prefix,
                endkey: `${prefix}\u9999`,
            });
        } catch (error) {
            this.log.warn(
                `Verwaiste Bridge-States konnten nicht geprüft werden: ${String(error)}`,
            );
            return;
        }

        const orphanIds = findOrphanedBridgeIds(
            result.rows ?? [],
            this.namespace,
            configuredIds,
        );

        for (const bridgeId of orphanIds) {
            let deletedCount = 0;

            for (const key of ORPHAN_BRIDGE_STATE_KEYS) {
                const id = `bridges.${bridgeId}.${key}`;

                try {
                    const object = await this.getObjectAsync(id);
                    if (object?.type === "state") {
                        await this.delObjectAsync(id);
                        deletedCount++;
                    }
                } catch (error) {
                    this.log.warn(
                        `Verwaister State "${id}" konnte nicht gelöscht werden: ${String(error)}`,
                    );
                }
            }

            if (deletedCount > 0) {
                this.log.info(
                    `Verwaiste Bridge-States für "${bridgeId}" bereinigt (${deletedCount}); Matter-Persistenz wurde nicht verändert.`,
                );
            }
        }
    }

    private async initializeBridgeStatusStates(
        bridges: Array<{ id: string }>,
    ): Promise<void> {
        const definitions: Array<{
            key: "status" | "pairingQr" | "pairingManualCode" | "commissioned" | "fabricCount";
            name: string;
            type: "string" | "boolean" | "number";
            role: string;
        }> = [
            { key: "status", name: "Bridge-Status", type: "string", role: "text" },
            { key: "pairingQr", name: "Matter QR-Pairing-Code", type: "string", role: "text" },
            { key: "pairingManualCode", name: "Matter manueller Pairing-Code", type: "string", role: "text" },
            { key: "commissioned", name: "Matter gekoppelt", type: "boolean", role: "indicator" },
            { key: "fabricCount", name: "Anzahl Matter-Fabrics", type: "number", role: "value" },
        ];

        for (const bridge of bridges) {
            for (const definition of definitions) {
                await this.setObjectNotExistsAsync(
                    `bridges.${bridge.id}.${definition.key}`,
                    {
                        type: "state",
                        common: {
                            name: definition.name,
                            type: definition.type,
                            role: definition.role,
                            read: true,
                            write: false,
                        },
                        native: {},
                    },
                );
            }

            await this.setBridgeRuntimeState(bridge.id, "status", "starting");
            await this.setBridgeRuntimeState(bridge.id, "pairingQr", "");
            await this.setBridgeRuntimeState(bridge.id, "pairingManualCode", "");
            await this.setBridgeMatterState(bridge.id, "commissioned", false);
            await this.setBridgeMatterState(bridge.id, "fabricCount", 0);
        }
    }

    private async setBridgeMatterState(
        bridgeId: string,
        key: "commissioned" | "fabricCount",
        value: boolean | number,
    ): Promise<void> {
        await this.setStateAsync(`bridges.${bridgeId}.${key}`, {
            val: value,
            ack: true,
        });
    }

    private async refreshBridgeMatterState(
        bridgeId: string,
        server: ServerNode,
    ): Promise<void> {
        const snapshot = await server.act(agent => {
            const commissioning = agent.get(CommissioningServer).state;
            const credentials = agent.get(OperationalCredentialsBehavior).state;

            return {
                commissioned: commissioning.commissioned,
                fabricCount: Object.keys(commissioning.fabrics).length,
                commissionedFabrics: credentials.commissionedFabrics,
                credentialsFabricCount: credentials.fabrics.length,
            };
        });

        this.log.info(
            `Matter-Statusdiagnose Bridge "${bridgeId}": ` +
            `commissioned=${snapshot.commissioned}, ` +
            `fabricCount=${snapshot.fabricCount}, ` +
            `commissionedFabrics=${snapshot.commissionedFabrics}, ` +
            `credentialsFabricCount=${snapshot.credentialsFabricCount}`,
        );

        await this.setBridgeMatterState(
            bridgeId,
            "commissioned",
            snapshot.commissioned,
        );
        await this.setBridgeMatterState(
            bridgeId,
            "fabricCount",
            snapshot.fabricCount,
        );
    }

    private registerBridgeCommissioningListeners(
        bridgeId: string,
        server: ServerNode,
    ): void {
        const events = server.events.commissioning;
        let resetPending = false;

        const refresh = (): void => {
            void this.refreshBridgeMatterState(bridgeId, server).catch((error: unknown) => {
                this.log.warn(
                    `Matter-Kopplungsstatus für Bridge "${bridgeId}" konnte nicht aktualisiert werden: ${String(error)}`,
                );
            });
        };

        const commissionedObserver = (): void => refresh();

        const decommissionedObserver = (): void => {
            resetPending = true;
            this.log.info(
                `Fabric-Diagnose Bridge "${bridgeId}": letztes Fabric entfernt; ` +
                `Factory-Reset erwartet. construction=${String(server.construction.status)}, ` +
                `online=${server.lifecycle.isOnline}.`,
            );
            refresh();
        };

        const fabricsChangedObserver = (): void => refresh();

        const constructionObserver = (): void => {
            if (!resetPending) {
                return;
            }

            const status = String(server.construction.status);
            const error = server.construction.error;

            this.log.info(
                `Fabric-Diagnose Bridge "${bridgeId}": construction=${status}, ` +
                `online=${server.lifecycle.isOnline}` +
                (error ? `, error=${String(error)}` : "") +
                ".",
            );

            if (status === "crashed") {
                this.log.error(
                    `Fabric-Diagnose Bridge "${bridgeId}": Matter-Konstruktion abgestürzt; ` +
                    `Reset-Fehler: ${String(error ?? "kein Fehlerobjekt verfügbar")}.`,
                );
                resetPending = false;
            }
        };

        const goingOfflineObserver = (): void => {
            if (resetPending) {
                this.log.info(
                    `Fabric-Diagnose Bridge "${bridgeId}": Server geht während des Resets offline.`,
                );
            }
        };

        const offlineObserver = (): void => {
            if (resetPending) {
                this.log.info(
                    `Fabric-Diagnose Bridge "${bridgeId}": Server ist offline.`,
                );
            }
        };

        const onlineObserver = (): void => {
            if (!resetPending) {
                return;
            }

            this.log.info(
                `Fabric-Diagnose Bridge "${bridgeId}": Server ist wieder online; ` +
                `construction=${String(server.construction.status)}.`,
            );

            void this.refreshBridgeMatterState(bridgeId, server)
                .then(() => {
                    this.log.info(
                        `Fabric-Diagnose Bridge "${bridgeId}": Status nach Wiederanlauf aktualisiert.`,
                    );
                    resetPending = false;

                    this.log.info(
                        `Fabric-Diagnose Bridge "${bridgeId}": Adapter-Neustart nach Fabric-Reset.`,
                    );
                    this.terminate(
                        "Letztes Matter-Fabric entfernt; Neustart nach Factory-Reset.",
                        156,
                    );
                })
                .catch((error: unknown) => {
                    this.log.warn(
                        `Fabric-Diagnose Bridge "${bridgeId}": Status nach Wiederanlauf ` +
                        `konnte nicht aktualisiert werden: ${String(error)}`,
                    );
                });
        };

        events.commissioned.on(commissionedObserver);
        events.decommissioned.on(decommissionedObserver);
        events.fabricsChanged.on(fabricsChangedObserver);

        server.construction.change.on(constructionObserver);
        server.lifecycle.goingOffline.on(goingOfflineObserver);
        server.lifecycle.offline.on(offlineObserver);
        server.lifecycle.online.on(onlineObserver);

        this.commissioningStateCleanup.set(bridgeId, () => {
            events.commissioned.off(commissionedObserver);
            events.decommissioned.off(decommissionedObserver);
            events.fabricsChanged.off(fabricsChangedObserver);

            server.construction.change.off(constructionObserver);
            server.lifecycle.goingOffline.off(goingOfflineObserver);
            server.lifecycle.offline.off(offlineObserver);
            server.lifecycle.online.off(onlineObserver);
        });
    }

    private async setBridgeRuntimeState(
        bridgeId: string,
        key: "status" | "pairingQr" | "pairingManualCode",
        value: string,
    ): Promise<void> {
        await this.setStateAsync(`bridges.${bridgeId}.${key}`, {
            val: value,
            ack: true,
        });
    }

    private async onReady(): Promise<void> {
        let config: NormalizedConfig;

        try {
            config = normalizeConfig(this.config as MatterBridgeConfig);
        } catch (error) {
            this.log.error(error instanceof Error ? error.message : String(error));
            return;
        }

        this.log.info(
            `Konfiguration geladen: ${config.bridges.length} Bridge(s), ` +
            `${config.devices.length} Gerät(e).`,
        );

        const usableDevices: Array<{
            config: DeviceConfig;
            initialValue: boolean | number;
            initialBrightness?: number;
        }> = [];

        for (const device of config.devices) {
            try {
                const object = await this.getForeignObjectAsync(device.stateId);

                if (!object) {
                    this.log.warn(
                        `State-Objekt nicht gefunden: ${device.stateId} ` +
                        `(Matter-Gerät "${device.name}").`,
                    );
                    continue;
                }

                const isSensor =
                    device.type === "temperatureSensor" ||
                    device.type === "humiditySensor";
                const expectedTypes = isSensor
                    ? ["number", "mixed"]
                    : ["boolean"];

                if (
                    object.type !== "state" ||
                    !expectedTypes.includes(String(object.common.type))
                ) {
                    this.log.warn(
                        `State "${device.stateId}" hat einen unpassenden Datentyp. ` +
                        `Gerät "${device.name}" wird übersprungen.`,
                    );
                    continue;
                }

                const state = await this.getForeignStateAsync(device.stateId);
                const validInitialValue =
                    device.type === "temperatureSensor"
                        ? isTemperature(state?.val)
                        : device.type === "humiditySensor"
                            ? isPercentage(state?.val)
                            : typeof state?.val === "boolean";

                if (!state || !validInitialValue) {
                    this.log.warn(
                        `State "${device.stateId}" hat aktuell keinen gültigen Wert ` +
                        `für Gerät "${device.name}".`,
                    );
                    continue;
                }

                let initialBrightness: number | undefined;

                if (device.type === "dimmableLight") {
                    const brightnessId = device.brightnessStateId!;
                    const brightnessObject = await this.getForeignObjectAsync(brightnessId);

                    if (
                        !brightnessObject ||
                        brightnessObject.type !== "state" ||
                        !["number", "mixed"].includes(String(brightnessObject.common.type))
                    ) {
                        this.log.warn(
                            `Helligkeits-State "${brightnessId}" ist kein numerischer State. ` +
                            `Gerät "${device.name}" wird übersprungen.`,
                        );
                        continue;
                    }

                    const brightnessState = await this.getForeignStateAsync(brightnessId);
                    if (!brightnessState || !isPercentage(brightnessState.val)) {
                        this.log.warn(
                            `Helligkeits-State "${brightnessId}" muss einen Zahlenwert von 0 bis 100 enthalten.`,
                        );
                        continue;
                    }

                    initialBrightness = brightnessState.val;
                    await this.subscribeForeignStates(brightnessId);
                }

                await this.subscribeForeignStates(device.stateId);
                usableDevices.push({
                    config: device,
                    initialValue: state.val as boolean | number,
                    ...(initialBrightness !== undefined ? { initialBrightness } : {}),
                });
            } catch (error) {
                this.log.warn(
                    `State "${device.stateId}" konnte nicht vorbereitet werden: ${String(error)}`,
                );
            }
        }

        await this.cleanupOrphanedBridgeStates(config.bridges);
        await this.initializeBridgeStatusStates(config.bridges);

        for (const bridge of config.bridges) {
            let server: ServerNode | undefined;

            try {
                server = await ServerNode.create({
                    id: bridge.id,
                    network: {
                        port: bridge.port,
                    },
                    productDescription: {
                        name: bridge.name,
                        deviceType: AggregatorEndpoint.deviceType,
                    },
                    basicInformation: {
                        vendorName: "Matter Bridge Slim",
                        vendorId: VendorId(0xfff1),
                        nodeLabel: bridge.name,
                        productName: bridge.name,
                        productLabel: bridge.name,
                        productId: 0x8000,
                        serialNumber: `matter-bridge-${bridge.id}`,
                        uniqueId: bridge.id,
                    },
                });

                const aggregator = new Endpoint(AggregatorEndpoint, {
                    id: "aggregator",
                });

                await server.add(aggregator);

                const bridgeDevices = usableDevices.filter(
                    (item) => item.config.bridgeId === bridge.id,
                );

                for (const item of bridgeDevices) {
                    const device = item.config;

                    const basicInformation = {
                        nodeLabel: device.name,
                        productName: device.name,
                        productLabel: device.name,
                        serialNumber: `matter-${bridge.id}-${device.id}`,
                        reachable: true,
                    };

                    const endpoint: Endpoint<any> = device.type === "dimmableLight"
                        ? new Endpoint(
                            DimmableLightDevice.with(
                                BridgedDeviceBasicInformationServer,
                            ),
                            {
                                id: `device-${device.id}`,
                                bridgedDeviceBasicInformation: basicInformation,
                                onOff: { onOff: item.initialValue as boolean },
                                levelControl: {
                                    currentLevel: percentageToMatterLevel(
                                        item.initialBrightness ?? 100,
                                    ),
                                },
                            },
                        )
                        : device.type === "temperatureSensor"
                            ? new Endpoint(
                                TemperatureSensorDevice.with(
                                    BridgedDeviceBasicInformationServer,
                                ),
                                {
                                    id: `device-${device.id}`,
                                    bridgedDeviceBasicInformation: basicInformation,
                                    temperatureMeasurement: {
                                        measuredValue: temperatureToMatter(
                                            item.initialValue as number,
                                        ),
                                    },
                                },
                            )
                            : device.type === "humiditySensor"
                                ? new Endpoint(
                                    HumiditySensorDevice.with(
                                        BridgedDeviceBasicInformationServer,
                                    ),
                                    {
                                        id: `device-${device.id}`,
                                        bridgedDeviceBasicInformation: basicInformation,
                                        relativeHumidityMeasurement: {
                                            measuredValue: humidityToMatter(
                                                item.initialValue as number,
                                            ),
                                        },
                                    },
                                )
                                : new Endpoint(
                                    OnOffPlugInUnitDevice.with(
                                        BridgedDeviceBasicInformationServer,
                                    ),
                                    {
                                        id: `device-${device.id}`,
                                        bridgedDeviceBasicInformation: basicInformation,
                                        onOff: { onOff: item.initialValue as boolean },
                                    },
                                );

                    await aggregator.add(endpoint);
                    if (device.type === "temperatureSensor") {
                        this.stateToEndpoint.set(device.stateId, {
                            endpoint,
                            kind: "temperature",
                        });
                    } else if (device.type === "humiditySensor") {
                        this.stateToEndpoint.set(device.stateId, {
                            endpoint,
                            kind: "humidity",
                        });
                    } else {
                        this.stateToEndpoint.set(device.stateId, {
                            endpoint,
                            kind: "onOff",
                        });
                    }

                    if (device.type === "dimmableLight" && device.brightnessStateId) {
                        this.stateToEndpoint.set(device.brightnessStateId, {
                            endpoint,
                            kind: "brightness",
                        });
                    }

                    if (
                        device.type === "switch" ||
                        device.type === "dimmableLight"
                    ) {
                    (endpoint as Endpoint<any>).events.onOff.onOff$Changed.on(async (value: boolean) => {
                        try {
                            const current = await this.getForeignStateAsync(
                                device.stateId,
                            );

                            if (current && current.val === value) {
                                return;
                            }

                            await this.setForeignStateAsync(
                                device.stateId,
                                value,
                            );

                            this.log.debug(
                                `Matter -> ioBroker: ${device.stateId} = ${String(value)}`,
                            );
                        } catch (error) {
                            this.log.error(
                                `Matter-Befehl für "${device.stateId}" fehlgeschlagen: ${String(error)}`,
                            );
                        }
                    });

                    }

                    const brightnessStateId = device.brightnessStateId;
                    if (device.type === "dimmableLight" && brightnessStateId) {
                        endpoint.eventsOf(LevelControlServer).currentLevel$Changed.on(
                            async (value) => {
                                if (typeof value !== "number") {
                                    return;
                                }

                                const percentage = matterLevelToPercentage(value);

                                try {
                                    const current = await this.getForeignStateAsync(
                                        brightnessStateId,
                                    );

                                    if (current && current.val === percentage) {
                                        return;
                                    }

                                    await this.setForeignStateAsync(
                                        brightnessStateId,
                                        percentage,
                                    );

                                    this.log.debug(
                                        `Matter -> ioBroker: ${brightnessStateId} = ${percentage} %`,
                                    );
                                } catch (error) {
                                    this.log.error(
                                        `Matter-Helligkeitsbefehl für "${brightnessStateId}" fehlgeschlagen: ${String(error)}`,
                                    );
                                }
                            },
                        );
                    }

                    this.log.info(
                        `${device.type === "dimmableLight" ? "Dimmbare Lampe" : "On/Off-Gerät"} ` +
                        `"${device.name}" vorbereitet: ${device.stateId} = ${String(item.initialValue)}` +
                        (device.brightnessStateId
                            ? `, ${device.brightnessStateId} = ${String(item.initialBrightness)} %`
                            : "") +
                        ".",
                    );
                }

                await server.start();
                this.matterServers.push(server);
                this.matterServersById.set(bridge.id, server);
                this.registerBridgeCommissioningListeners(bridge.id, server);
                await this.refreshBridgeMatterState(bridge.id, server);

                this.log.info(
                    `Matter-Bridge "${bridge.name}" gestartet: ` +
                    `${bridgeDevices.length} Gerät(e), Port ${bridge.port}.`,
                );

                await this.setBridgeRuntimeState(bridge.id, "status", "online");

                const pairingCodes = server.state.commissioning.pairingCodes;
                await this.setBridgeRuntimeState(
                    bridge.id,
                    "pairingQr",
                    pairingCodes.qrPairingCode ?? "",
                );
                await this.setBridgeRuntimeState(
                    bridge.id,
                    "pairingManualCode",
                    pairingCodes.manualPairingCode ?? "",
                );

                if (pairingCodes.qrPairingCode) {
                    this.log.info(
                        `Pairing-QR für Bridge "${bridge.name}": ` +
                        pairingCodes.qrPairingCode,
                    );
                }

                if (pairingCodes.manualPairingCode) {
                    this.log.info(
                        `Manueller Pairing-Code für Bridge "${bridge.name}": ` +
                        pairingCodes.manualPairingCode,
                    );
                }
            } catch (error) {
                if (server) {
                    const cleanupCommissioning = this.commissioningStateCleanup.get(bridge.id);
                    if (cleanupCommissioning) {
                        cleanupCommissioning();
                        this.commissioningStateCleanup.delete(bridge.id);
                    }

                    try {
                        await server.stop();

                        if (this.matterServersById.get(bridge.id) === server) {
                            this.matterServersById.delete(bridge.id);
                        }

                        const serverIndex = this.matterServers.indexOf(server);
                        if (serverIndex >= 0) {
                            this.matterServers.splice(serverIndex, 1);
                        }
                    } catch (cleanupError) {
                        this.log.warn(
                            `Matter-Server "${bridge.id}" konnte nach dem Startfehler nicht ` +
                            `gestoppt werden; Referenzen bleiben für die Bereinigung erhalten: ` +
                            `${String(cleanupError)}`,
                        );
                    }
                }

                try {
                    await this.setBridgeRuntimeState(bridge.id, "status", "error");
                    await this.setBridgeRuntimeState(bridge.id, "pairingQr", "");
                    await this.setBridgeRuntimeState(bridge.id, "pairingManualCode", "");
                    await this.setBridgeMatterState(bridge.id, "commissioned", false);
                    await this.setBridgeMatterState(bridge.id, "fabricCount", 0);
                } catch (statusError) {
                    this.log.warn(
                        `Status für Bridge "${bridge.id}" konnte nicht geschrieben werden: ${String(statusError)}`,
                    );
                }

                this.log.error(
                    `Matter-Bridge "${bridge.name}" (${bridge.id}) konnte nicht ` +
                    `gestartet werden: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
                );

            }
        }

        this.log.info(
            `Matter-Server gestartet: ${this.matterServers.length} von ` +
            `${config.bridges.length} konfigurierten Bridge(s).`,
        );
    }
}

if (require.main === module) {
    new MatterBridgeSlim();
}

export = MatterBridgeSlim;
