"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_TYPE_REGISTRY = void 0;
exports.isDeviceType = isDeviceType;
/**
 * Gemeinsame Quelle für die unterstützten Matter-Gerätetypen.
 * Backend und Admin-Frontend verwenden dieselben Definitionen.
 */
exports.DEVICE_TYPE_REGISTRY = {
    switch: {
        label: "Schalter",
        stateLabel: "ioBroker-State-ID (Ein/Aus)",
        stateKind: "boolean",
        additionalStateFields: [],
    },
    dimmableLight: {
        label: "Dimmbare Lampe",
        stateLabel: "ioBroker-State-ID (Ein/Aus)",
        stateKind: "boolean",
        additionalStateFields: [
            {
                key: "brightnessStateId",
                label: "Helligkeit",
                inputLabel: "Helligkeits-State-ID (0–100 %)",
                pickerLabel: "Helligkeits-State auswählen",
                required: true,
            },
        ],
    },
    temperatureSensor: {
        label: "Temperatursensor",
        stateLabel: "ioBroker-State-ID (Temperatur °C)",
        stateKind: "temperature",
        additionalStateFields: [],
    },
    humiditySensor: {
        label: "Luftfeuchtigkeitssensor",
        stateLabel: "ioBroker-State-ID (relative Luftfeuchtigkeit %)",
        stateKind: "percentage",
        additionalStateFields: [],
    },
};
function isDeviceType(value) {
    return typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(exports.DEVICE_TYPE_REGISTRY, value);
}
//# sourceMappingURL=device-registry.js.map