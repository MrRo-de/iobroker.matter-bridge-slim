/**
 * Gemeinsame Quelle für die unterstützten Matter-Gerätetypen.
 * Backend und Admin-Frontend verwenden dieselben Definitionen.
 */
export const DEVICE_TYPE_REGISTRY = {
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
} as const;

export type DeviceType = keyof typeof DEVICE_TYPE_REGISTRY;

export function isDeviceType(value: unknown): value is DeviceType {
    return typeof value === "string" &&
        Object.prototype.hasOwnProperty.call(DEVICE_TYPE_REGISTRY, value);
}
