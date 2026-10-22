/**
 * Gemeinsame Quelle für die unterstützten Matter-Gerätetypen.
 * Backend und Admin-Frontend verwenden dieselben Definitionen.
 */
export declare const DEVICE_TYPE_REGISTRY: {
    readonly switch: {
        readonly label: "Schalter";
        readonly stateLabel: "ioBroker-State-ID (Ein/Aus)";
        readonly stateKind: "boolean";
        readonly additionalStateFields: readonly [];
    };
    readonly dimmableLight: {
        readonly label: "Dimmbare Lampe";
        readonly stateLabel: "ioBroker-State-ID (Ein/Aus)";
        readonly stateKind: "boolean";
        readonly additionalStateFields: readonly [{
            readonly key: "brightnessStateId";
            readonly label: "Helligkeit";
            readonly inputLabel: "Helligkeits-State-ID (0–100 %)";
            readonly pickerLabel: "Helligkeits-State auswählen";
            readonly required: true;
        }];
    };
    readonly temperatureSensor: {
        readonly label: "Temperatursensor";
        readonly stateLabel: "ioBroker-State-ID (Temperatur °C)";
        readonly stateKind: "temperature";
        readonly additionalStateFields: readonly [];
    };
    readonly humiditySensor: {
        readonly label: "Luftfeuchtigkeitssensor";
        readonly stateLabel: "ioBroker-State-ID (relative Luftfeuchtigkeit %)";
        readonly stateKind: "percentage";
        readonly additionalStateFields: readonly [];
    };
};
export type DeviceType = keyof typeof DEVICE_TYPE_REGISTRY;
export declare function isDeviceType(value: unknown): value is DeviceType;
