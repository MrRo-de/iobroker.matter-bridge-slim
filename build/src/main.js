"use strict";
const adapter_core_1 = require("@iobroker/adapter-core");
const main_1 = require("@matter/main");
const commissioning_1 = require("@matter/node/behaviors/system/commissioning");
const bridged_device_basic_information_1 = require("@matter/main/behaviors/bridged-device-basic-information");
const on_off_1 = require("@matter/main/behaviors/on-off");
const on_off_plug_in_unit_1 = require("@matter/main/devices/on-off-plug-in-unit");
const dimmable_light_1 = require("@matter/main/devices/dimmable-light");
const level_control_1 = require("@matter/main/behaviors/level-control");
const aggregator_1 = require("@matter/main/endpoints/aggregator");
const temperature_sensor_1 = require("@matter/main/devices/temperature-sensor");
const humidity_sensor_1 = require("@matter/main/devices/humidity-sensor");
const temperature_measurement_1 = require("@matter/main/behaviors/temperature-measurement");
const relative_humidity_measurement_1 = require("@matter/main/behaviors/relative-humidity-measurement");
const device_registry_js_1 = require("../shared/device-registry.js");
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isPercentage(value) {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100;
}
function isTemperature(value) {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= -273.15 &&
        value <= 327.67;
}
function temperatureToMatter(value) {
    return Math.round(value * 100);
}
function humidityToMatter(value) {
    return Math.round(value * 100);
}
function percentageToMatterLevel(value) {
    // Matter CurrentLevel: 1–254; 0 % wird über On/Off abgebildet.
    return Math.max(1, Math.min(254, Math.round(value * 254 / 100)));
}
function matterLevelToPercentage(value) {
    // Matter-Level 1–254 entspricht mindestens 1 %; 0 % wird über On/Off abgebildet.
    return Math.max(1, Math.min(100, Math.round(value * 100 / 254)));
}
function normalizeConfig(raw) {
    const errors = [];
    const bridges = [];
    const devices = [];
    const rawBridges = Array.isArray(raw.bridges) ? raw.bridges : [];
    const rawDevices = Array.isArray(raw.devices) ? raw.devices : [];
    const bridgeIds = new Set();
    const ports = new Set();
    const deviceIds = new Set();
    const stateIds = new Set();
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
        if (typeof port !== "number" ||
            !Number.isInteger(port) ||
            port < 5540 ||
            port > 65535) {
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
        if (!nonEmptyString(stateId) ||
            stateId.trim() !== stateId ||
            /\s/.test(stateId) ||
            !stateId.includes(".")) {
            errors.push(`Gerät "${id}": ungültige ioBroker-State-ID.`);
            continue;
        }
        if (!(0, device_registry_js_1.isDeviceType)(type)) {
            errors.push(`Gerät "${id}": ungültiger Gerätetyp "${String(type)}". ` +
                "Bitte einen in der Geräte-Registry definierten Typ verwenden.");
            continue;
        }
        const configuredAdditionalStateIds = {};
        let additionalFieldsInvalid = false;
        const selectedFields = device_registry_js_1.DEVICE_TYPE_REGISTRY[type].additionalStateFields;
        const allAdditionalFields = Object.values(device_registry_js_1.DEVICE_TYPE_REGISTRY)
            .flatMap((definition) => definition.additionalStateFields);
        for (const field of selectedFields) {
            const value = item[field.key];
            if (value === undefined || value === "") {
                if (field.required) {
                    errors.push(`Gerät "${id}": das Zusatzfeld "${field.key}" ist erforderlich.`);
                    additionalFieldsInvalid = true;
                }
                continue;
            }
            if (!nonEmptyString(value) ||
                value.trim() !== value ||
                /\\s/.test(value) ||
                !value.includes(".")) {
                errors.push(`Gerät "${id}": ungültige State-ID im Zusatzfeld "${field.key}".`);
                additionalFieldsInvalid = true;
                continue;
            }
            if (value === stateId ||
                stateIds.has(value) ||
                Object.values(configuredAdditionalStateIds).includes(value)) {
                errors.push(`Gerät "${id}": ein ioBroker-State ist bereits einem anderen Feld oder Matter-Gerät zugeordnet.`);
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
                errors.push(`Gerät "${id}": das Zusatzfeld "${field.key}" ist für den Gerätetyp "${type}" nicht zulässig.`);
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
class MatterBridgeSlim extends adapter_core_1.Adapter {
    stateToEndpoint = new Map();
    matterServers = [];
    matterServersById = new Map();
    constructor(options = {}) {
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
            let update;
            if (mapping.kind === "onOff" && typeof state.val === "boolean") {
                update = mapping.endpoint.setStateOf(on_off_1.OnOffServer, {
                    onOff: state.val,
                });
            }
            else if (mapping.kind === "brightness" && isPercentage(state.val)) {
                if (state.val === 0) {
                    // 0 % bedeutet ausgeschaltet; den letzten Matter-Level beibehalten.
                    update = mapping.endpoint.setStateOf(on_off_1.OnOffServer, {
                        onOff: false,
                    });
                }
                else {
                    // Eine positive Helligkeit schaltet ein und setzt den Level.
                    update = Promise.all([
                        mapping.endpoint.setStateOf(level_control_1.LevelControlServer, {
                            currentLevel: percentageToMatterLevel(state.val),
                        }),
                        mapping.endpoint.setStateOf(on_off_1.OnOffServer, {
                            onOff: true,
                        }),
                    ]);
                }
            }
            else if (mapping.kind === "temperature" && isTemperature(state.val)) {
                update = mapping.endpoint.setStateOf(temperature_measurement_1.TemperatureMeasurementServer, {
                    measuredValue: temperatureToMatter(state.val),
                });
            }
            else if (mapping.kind === "humidity" && isPercentage(state.val)) {
                update = mapping.endpoint.setStateOf(relative_humidity_measurement_1.RelativeHumidityMeasurementServer, {
                    measuredValue: humidityToMatter(state.val),
                });
            }
            if (update) {
                void update.catch((error) => {
                    this.log.warn(`Matter-Zustand für "${id}" konnte nicht aktualisiert werden: ${String(error)}`);
                });
            }
        });
        this.on("message", (obj) => {
            if (!obj || obj.command !== "reopenCommissioning") {
                return;
            }
            this.log.info(`Diagnose reopenCommissioning: Nachricht empfangen; from=${String(obj.from)}, callback=${String(Boolean(obj.callback))}`);
            if (!obj.callback) {
                this.log.warn("Diagnose reopenCommissioning: Kein Callback in der Nachricht.");
                return;
            }
            const bridgeId = isRecord(obj.message) ? obj.message.bridgeId : undefined;
            this.log.info(`Diagnose reopenCommissioning: bridgeId=${String(bridgeId)}`);
            if (!nonEmptyString(bridgeId)) {
                this.sendTo(obj.from, obj.command, { ok: false, error: "Ungültige Bridge-ID." }, obj.callback);
                return;
            }
            const server = this.matterServersById.get(bridgeId);
            if (!server) {
                this.sendTo(obj.from, obj.command, {
                    ok: false,
                    error: `Bridge "${bridgeId}" ist nicht aktiv.`,
                }, obj.callback);
                return;
            }
            this.log.info(`Diagnose reopenCommissioning: Rufe enterCommissionableMode für "${bridgeId}" auf.`);
            void Promise.resolve(server.act(agent => agent.get(commissioning_1.CommissioningServer).enterCommissionableMode()))
                .then(() => {
                this.log.info(`Diagnose reopenCommissioning: enterCommissionableMode für "${bridgeId}" erfolgreich.`);
                this.sendTo(obj.from, obj.command, { ok: true }, obj.callback);
                this.log.info(`Diagnose reopenCommissioning: Erfolgsantwort für "${bridgeId}" gesendet.`);
            })
                .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                this.log.warn(`Diagnose reopenCommissioning: Commissioning für Bridge "${bridgeId}" fehlgeschlagen: ${message}`);
                this.sendTo(obj.from, obj.command, { ok: false, error: message }, obj.callback);
            });
        });
        this.on("unload", (callback) => {
            this.unsubscribeForeignStates("*", (error) => {
                if (error) {
                    this.log.debug(`Abmelden der State-Abonnements: ${String(error)}`);
                }
                void Promise.allSettled(this.matterServers.map((server) => server.stop())).then(() => callback());
            });
        });
    }
    async initializeBridgeStatusStates(bridges) {
        const definitions = [
            { key: "status", name: "Bridge-Status" },
            { key: "pairingQr", name: "Matter QR-Pairing-Code" },
            { key: "pairingManualCode", name: "Matter manueller Pairing-Code" },
        ];
        for (const bridge of bridges) {
            for (const definition of definitions) {
                await this.setObjectNotExistsAsync(`bridges.${bridge.id}.${definition.key}`, {
                    type: "state",
                    common: {
                        name: definition.name,
                        type: "string",
                        role: "text",
                        read: true,
                        write: false,
                    },
                    native: {},
                });
            }
            await this.setBridgeRuntimeState(bridge.id, "status", "starting");
            await this.setBridgeRuntimeState(bridge.id, "pairingQr", "");
            await this.setBridgeRuntimeState(bridge.id, "pairingManualCode", "");
        }
    }
    async setBridgeRuntimeState(bridgeId, key, value) {
        await this.setStateAsync(`bridges.${bridgeId}.${key}`, {
            val: value,
            ack: true,
        });
    }
    async onReady() {
        let config;
        try {
            config = normalizeConfig(this.config);
        }
        catch (error) {
            this.log.error(error instanceof Error ? error.message : String(error));
            return;
        }
        this.log.info(`Konfiguration geladen: ${config.bridges.length} Bridge(s), ` +
            `${config.devices.length} Gerät(e).`);
        const usableDevices = [];
        for (const device of config.devices) {
            try {
                const object = await this.getForeignObjectAsync(device.stateId);
                if (!object) {
                    this.log.warn(`State-Objekt nicht gefunden: ${device.stateId} ` +
                        `(Matter-Gerät "${device.name}").`);
                    continue;
                }
                const isSensor = device.type === "temperatureSensor" ||
                    device.type === "humiditySensor";
                const expectedTypes = isSensor
                    ? ["number", "mixed"]
                    : ["boolean"];
                if (object.type !== "state" ||
                    !expectedTypes.includes(String(object.common.type))) {
                    this.log.warn(`State "${device.stateId}" hat einen unpassenden Datentyp. ` +
                        `Gerät "${device.name}" wird übersprungen.`);
                    continue;
                }
                const state = await this.getForeignStateAsync(device.stateId);
                const validInitialValue = device.type === "temperatureSensor"
                    ? isTemperature(state?.val)
                    : device.type === "humiditySensor"
                        ? isPercentage(state?.val)
                        : typeof state?.val === "boolean";
                if (!state || !validInitialValue) {
                    this.log.warn(`State "${device.stateId}" hat aktuell keinen gültigen Wert ` +
                        `für Gerät "${device.name}".`);
                    continue;
                }
                let initialBrightness;
                if (device.type === "dimmableLight") {
                    const brightnessId = device.brightnessStateId;
                    const brightnessObject = await this.getForeignObjectAsync(brightnessId);
                    if (!brightnessObject ||
                        brightnessObject.type !== "state" ||
                        !["number", "mixed"].includes(String(brightnessObject.common.type))) {
                        this.log.warn(`Helligkeits-State "${brightnessId}" ist kein numerischer State. ` +
                            `Gerät "${device.name}" wird übersprungen.`);
                        continue;
                    }
                    const brightnessState = await this.getForeignStateAsync(brightnessId);
                    if (!brightnessState || !isPercentage(brightnessState.val)) {
                        this.log.warn(`Helligkeits-State "${brightnessId}" muss einen Zahlenwert von 0 bis 100 enthalten.`);
                        continue;
                    }
                    initialBrightness = brightnessState.val;
                    await this.subscribeForeignStates(brightnessId);
                }
                await this.subscribeForeignStates(device.stateId);
                usableDevices.push({
                    config: device,
                    initialValue: state.val,
                    ...(initialBrightness !== undefined ? { initialBrightness } : {}),
                });
            }
            catch (error) {
                this.log.warn(`State "${device.stateId}" konnte nicht vorbereitet werden: ${String(error)}`);
            }
        }
        await this.initializeBridgeStatusStates(config.bridges);
        for (const bridge of config.bridges) {
            let server;
            try {
                server = await main_1.ServerNode.create({
                    id: bridge.id,
                    network: {
                        port: bridge.port,
                    },
                    productDescription: {
                        name: bridge.name,
                        deviceType: aggregator_1.AggregatorEndpoint.deviceType,
                    },
                    basicInformation: {
                        vendorName: "Matter Bridge Slim",
                        vendorId: (0, main_1.VendorId)(0xfff1),
                        nodeLabel: bridge.name,
                        productName: bridge.name,
                        productLabel: bridge.name,
                        productId: 0x8000,
                        serialNumber: `matter-bridge-${bridge.id}`,
                        uniqueId: bridge.id,
                    },
                });
                const aggregator = new main_1.Endpoint(aggregator_1.AggregatorEndpoint, {
                    id: "aggregator",
                });
                await server.add(aggregator);
                const bridgeDevices = usableDevices.filter((item) => item.config.bridgeId === bridge.id);
                for (const item of bridgeDevices) {
                    const device = item.config;
                    const basicInformation = {
                        nodeLabel: device.name,
                        productName: device.name,
                        productLabel: device.name,
                        serialNumber: `matter-${bridge.id}-${device.id}`,
                        reachable: true,
                    };
                    const endpoint = device.type === "dimmableLight"
                        ? new main_1.Endpoint(dimmable_light_1.DimmableLightDevice.with(bridged_device_basic_information_1.BridgedDeviceBasicInformationServer), {
                            id: `device-${device.id}`,
                            bridgedDeviceBasicInformation: basicInformation,
                            onOff: { onOff: item.initialValue },
                            levelControl: {
                                currentLevel: percentageToMatterLevel(item.initialBrightness ?? 100),
                            },
                        })
                        : device.type === "temperatureSensor"
                            ? new main_1.Endpoint(temperature_sensor_1.TemperatureSensorDevice.with(bridged_device_basic_information_1.BridgedDeviceBasicInformationServer), {
                                id: `device-${device.id}`,
                                bridgedDeviceBasicInformation: basicInformation,
                                temperatureMeasurement: {
                                    measuredValue: temperatureToMatter(item.initialValue),
                                },
                            })
                            : device.type === "humiditySensor"
                                ? new main_1.Endpoint(humidity_sensor_1.HumiditySensorDevice.with(bridged_device_basic_information_1.BridgedDeviceBasicInformationServer), {
                                    id: `device-${device.id}`,
                                    bridgedDeviceBasicInformation: basicInformation,
                                    relativeHumidityMeasurement: {
                                        measuredValue: humidityToMatter(item.initialValue),
                                    },
                                })
                                : new main_1.Endpoint(on_off_plug_in_unit_1.OnOffPlugInUnitDevice.with(bridged_device_basic_information_1.BridgedDeviceBasicInformationServer), {
                                    id: `device-${device.id}`,
                                    bridgedDeviceBasicInformation: basicInformation,
                                    onOff: { onOff: item.initialValue },
                                });
                    await aggregator.add(endpoint);
                    if (device.type === "temperatureSensor") {
                        this.stateToEndpoint.set(device.stateId, {
                            endpoint,
                            kind: "temperature",
                        });
                    }
                    else if (device.type === "humiditySensor") {
                        this.stateToEndpoint.set(device.stateId, {
                            endpoint,
                            kind: "humidity",
                        });
                    }
                    else {
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
                    if (device.type === "switch" ||
                        device.type === "dimmableLight") {
                        endpoint.events.onOff.onOff$Changed.on(async (value) => {
                            try {
                                const current = await this.getForeignStateAsync(device.stateId);
                                if (current && current.val === value) {
                                    return;
                                }
                                await this.setForeignStateAsync(device.stateId, value);
                                this.log.debug(`Matter -> ioBroker: ${device.stateId} = ${String(value)}`);
                            }
                            catch (error) {
                                this.log.error(`Matter-Befehl für "${device.stateId}" fehlgeschlagen: ${String(error)}`);
                            }
                        });
                    }
                    const brightnessStateId = device.brightnessStateId;
                    if (device.type === "dimmableLight" && brightnessStateId) {
                        endpoint.eventsOf(level_control_1.LevelControlServer).currentLevel$Changed.on(async (value) => {
                            if (typeof value !== "number") {
                                return;
                            }
                            const percentage = matterLevelToPercentage(value);
                            try {
                                const current = await this.getForeignStateAsync(brightnessStateId);
                                if (current && current.val === percentage) {
                                    return;
                                }
                                await this.setForeignStateAsync(brightnessStateId, percentage);
                                this.log.debug(`Matter -> ioBroker: ${brightnessStateId} = ${percentage} %`);
                            }
                            catch (error) {
                                this.log.error(`Matter-Helligkeitsbefehl für "${brightnessStateId}" fehlgeschlagen: ${String(error)}`);
                            }
                        });
                    }
                    this.log.info(`${device.type === "dimmableLight" ? "Dimmbare Lampe" : "On/Off-Gerät"} ` +
                        `"${device.name}" vorbereitet: ${device.stateId} = ${String(item.initialValue)}` +
                        (device.brightnessStateId
                            ? `, ${device.brightnessStateId} = ${String(item.initialBrightness)} %`
                            : "") +
                        ".");
                }
                await server.start();
                this.matterServers.push(server);
                this.matterServersById.set(bridge.id, server);
                this.log.info(`Matter-Bridge "${bridge.name}" gestartet: ` +
                    `${bridgeDevices.length} Gerät(e), Port ${bridge.port}.`);
                await this.setBridgeRuntimeState(bridge.id, "status", "online");
                const pairingCodes = server.state.commissioning.pairingCodes;
                await this.setBridgeRuntimeState(bridge.id, "pairingQr", pairingCodes.qrPairingCode ?? "");
                await this.setBridgeRuntimeState(bridge.id, "pairingManualCode", pairingCodes.manualPairingCode ?? "");
                if (pairingCodes.qrPairingCode) {
                    this.log.info(`Pairing-QR für Bridge "${bridge.name}": ` +
                        pairingCodes.qrPairingCode);
                }
                if (pairingCodes.manualPairingCode) {
                    this.log.info(`Manueller Pairing-Code für Bridge "${bridge.name}": ` +
                        pairingCodes.manualPairingCode);
                }
            }
            catch (error) {
                try {
                    await this.setBridgeRuntimeState(bridge.id, "status", "error");
                    await this.setBridgeRuntimeState(bridge.id, "pairingQr", "");
                    await this.setBridgeRuntimeState(bridge.id, "pairingManualCode", "");
                }
                catch (statusError) {
                    this.log.warn(`Status für Bridge "${bridge.id}" konnte nicht geschrieben werden: ${String(statusError)}`);
                }
                this.log.error(`Matter-Bridge "${bridge.name}" (${bridge.id}) konnte nicht ` +
                    `gestartet werden: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
                if (server && !this.matterServers.includes(server)) {
                    try {
                        await server.stop();
                    }
                    catch {
                        // Fehler beim Aufräumen nicht über den Startfehler stellen.
                    }
                }
            }
        }
        this.log.info(`Matter-Server gestartet: ${this.matterServers.length} von ` +
            `${config.bridges.length} konfigurierten Bridge(s).`);
    }
}
if (require.main === module) {
    new MatterBridgeSlim();
}
module.exports = MatterBridgeSlim;
//# sourceMappingURL=main.js.map