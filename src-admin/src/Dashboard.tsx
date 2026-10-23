import React from 'react';
import { DEVICE_TYPE_REGISTRY, type DeviceType } from '../../shared/device-registry';
import QRCode from 'react-qr-code';
import { DialogSelectID, type IobTheme } from '@iobroker/gui-components';
import type { AdminConnection } from '@iobroker/socket-client';
import {
    Alert,
    Button,
    Card,
    CardContent,
    Divider,
    MenuItem,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import {
    ConfigGeneric,
    type ConfigGenericProps,
    type ConfigGenericState,
} from '@iobroker/json-config';

type Bridge = {
    id: string;
    name: string;
    port: number | string;
};

type Device = {
    id: string;
    bridgeId: string;
    name: string;
    type: DeviceType;
    stateId: string;
    brightnessStateId?: string;
    [key: string]: string | undefined;
};

interface BridgeRuntime {
    status: string;
    pairingQr: string;
    pairingManualCode: string;
    commissioned: boolean;
    fabricCount: number;
}

interface DashboardState extends ConfigGenericState {
    bridgeDraft: Bridge;
    deviceDraft: Device;
    showSelectId: boolean;
    selectIdTarget: 'stateId' | 'brightnessStateId';
    bridgeRuntime: Record<string, BridgeRuntime>;
}

const emptyBridge = (): Bridge => ({ id: '', name: '', port: 5540 });
const emptyDevice = (): Device => ({
    id: '',
    bridgeId: '',
    name: '',
    type: 'switch',
    stateId: '',
    brightnessStateId: '',
});

export default class Dashboard extends ConfigGeneric<ConfigGenericProps, DashboardState> {
    private bridgeSubscriptions = new Map<string, {
        ids: string[];
        handler: ioBroker.StateChangeHandler;
    }>();

    componentDidMount(): Promise<void> {
        this.syncBridgeSubscriptions();
        return Promise.resolve();
    }

    componentDidUpdate(): void {
        this.syncBridgeSubscriptions();
    }

    componentWillUnmount(): void {
        const connection = this.props as ConfigGenericProps & {
            socket: AdminConnection;
        };

        for (const subscription of this.bridgeSubscriptions.values()) {
            connection.socket.unsubscribeState(subscription.ids, subscription.handler);
        }
        this.bridgeSubscriptions.clear();
    }

    private syncBridgeSubscriptions = (): void => {
        const connection = this.props as ConfigGenericProps & {
            socket: AdminConnection;
            adapterName: string;
            instance: number | string;
        };
        const bridges = this.readArray<Bridge>('bridges');
        const activeIds = new Set(bridges.map(bridge => bridge.id));

        for (const [bridgeId, subscription] of this.bridgeSubscriptions) {
            if (!activeIds.has(bridgeId)) {
                connection.socket.unsubscribeState(subscription.ids, subscription.handler);
                this.bridgeSubscriptions.delete(bridgeId);
                this.setState(state => {
                    const bridgeRuntime = { ...state.bridgeRuntime };
                    delete bridgeRuntime[bridgeId];
                    return { bridgeRuntime };
                });
            }
        }

        for (const bridge of bridges) {
            if (this.bridgeSubscriptions.has(bridge.id)) continue;

            const prefix = `${connection.adapterName}.${connection.instance}.bridges.${bridge.id}`;
            const ids = [
                `${prefix}.status`,
                `${prefix}.pairingQr`,
                `${prefix}.pairingManualCode`,
                `${prefix}.commissioned`,
                `${prefix}.fabricCount`,
            ];

            const handler: ioBroker.StateChangeHandler = (id, state) => {
                const field = id.slice(prefix.length + 1) as keyof BridgeRuntime;
                if (
                    field !== 'status' &&
                    field !== 'pairingQr' &&
                    field !== 'pairingManualCode' &&
                    field !== 'commissioned' &&
                    field !== 'fabricCount'
                ) {
                    return;
                }

                const value =
                    field === 'commissioned'
                        ? state?.val === true
                        : field === 'fabricCount'
                          ? Number(state?.val ?? 0)
                          : String(state?.val ?? '');

                this.setState(previous => ({
                    bridgeRuntime: {
                        ...previous.bridgeRuntime,
                        [bridge.id]: {
                            ...(previous.bridgeRuntime[bridge.id] ?? {
                                status: 'Noch kein Status',
                                pairingQr: '',
                                pairingManualCode: '',
                                commissioned: false,
                                fabricCount: 0,
                            }),
                            [field]: value,
                        },
                    },
                }));
            };

            this.bridgeSubscriptions.set(bridge.id, { ids, handler });

            void connection.socket.subscribeState(ids, handler).catch(error => {
                if (!this.bridgeSubscriptions.has(bridge.id)) return;
                this.setState(previous => ({
                    bridgeRuntime: {
                        ...previous.bridgeRuntime,
                        [bridge.id]: {
                            ...(previous.bridgeRuntime[bridge.id] ?? {
                                pairingQr: '',
                                pairingManualCode: '',
                            }),
                            status: `Abonnementfehler: ${String(error)}`,
                        },
                    },
                }));
            });
        }
    };

    constructor(props: ConfigGenericProps) {
        super(props);
        this.state = {
            ...this.state,
            bridgeDraft: emptyBridge(),
            deviceDraft: emptyDevice(),
            showSelectId: false,
            selectIdTarget: 'stateId',
            bridgeRuntime: {},
        };
    }

    private readArray<T>(key: string): T[] {
        const value = ConfigGeneric.getValue(this.props.data, key);
        return Array.isArray(value) ? value as T[] : [];
    }

    private updateBridges(bridges: Bridge[]): void {
        void this.onChange('bridges', bridges);
    }

    private updateDevices(devices: Device[]): void {
        void this.onChange('devices', devices);
    }

    private updateBridgeDraft(key: keyof Bridge, value: string): void {
        this.setState(state => ({
            bridgeDraft: {
                ...state.bridgeDraft,
                [key]: key === 'port' ? value : value,
            },
        }));
    }

    private updateDeviceDraft(key: keyof Device, value: string): void {
        this.setState(state => ({
            deviceDraft: { ...state.deviceDraft, [key]: value },
        }));
    }

    private refreshBridgeRuntime = async (bridgeId: string): Promise<void> => {
        const connection = this.props as ConfigGenericProps & {
            socket: AdminConnection;
            adapterName: string;
            instance: number | string;
        };
        const prefix = `${connection.adapterName}.${connection.instance}.bridges.${bridgeId}`;

        try {
            const [status, qr, manual, commissioned, fabricCount] = await Promise.all([
                connection.socket.getState(`${prefix}.status`),
                connection.socket.getState(`${prefix}.pairingQr`),
                connection.socket.getState(`${prefix}.pairingManualCode`),
                connection.socket.getState(`${prefix}.commissioned`),
                connection.socket.getState(`${prefix}.fabricCount`),
            ]);

            this.setState(state => ({
                bridgeRuntime: {
                    ...state.bridgeRuntime,
                    [bridgeId]: {
                        status: String(status?.val ?? 'Noch kein Status'),
                        pairingQr: String(qr?.val ?? ''),
                        pairingManualCode: String(manual?.val ?? ''),
                        commissioned: commissioned?.val === true,
                        fabricCount: Number(fabricCount?.val ?? 0),
                    },
                },
            }));
        } catch (error) {
            this.setState(state => ({
                bridgeRuntime: {
                    ...state.bridgeRuntime,
                    [bridgeId]: {
                        status: `Abruffehler: ${String(error)}`,
                        pairingQr: '',
                        pairingManualCode: '',
                        commissioned: false,
                        fabricCount: 0,
                    },
                },
            }));
        }
    };

    private deleteBridge = async (bridgeId: string): Promise<void> => {
        if (!window.confirm(
            `Bridge "${bridgeId}" und ihre Matter-Identität einschließlich gespeicherter Fabrics endgültig löschen?`,
        )) {
            return;
        }

        const connection = this.props as ConfigGenericProps & {
            socket: AdminConnection;
            adapterName: string;
            instance: number | string;
        };
        const target = `${connection.adapterName}.${connection.instance}`;

        this.setState(state => ({
            bridgeRuntime: {
                ...state.bridgeRuntime,
                [bridgeId]: {
                    ...(state.bridgeRuntime[bridgeId] ?? {
                        pairingQr: '',
                        pairingManualCode: '',
                    }),
                    status: 'Bridge wird vollständig gelöscht …',
                },
            },
        }));

        try {
            const result = await connection.socket.sendTo(
                target,
                'deleteBridge',
                { bridgeId },
            ) as { ok?: boolean; error?: string };

            if (!result?.ok) {
                throw new Error(result?.error || 'Keine Bestätigung vom Adapter erhalten.');
            }

            const currentData = this.props.data;
            const bridges = Array.isArray(currentData.bridges)
                ? currentData.bridges as Bridge[]
                : [];
            const devices = Array.isArray(currentData.devices)
                ? currentData.devices as Device[]
                : [];

            this.props.onChange({
                ...currentData,
                bridges: bridges.filter(item => item.id !== bridgeId),
                devices: devices.filter(item => item.bridgeId !== bridgeId),
            }, undefined);

            this.setState(state => {
                const bridgeRuntime = { ...state.bridgeRuntime };
                delete bridgeRuntime[bridgeId];
                return { bridgeRuntime };
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.setState(state => ({
                bridgeRuntime: {
                    ...state.bridgeRuntime,
                    [bridgeId]: {
                        ...(state.bridgeRuntime[bridgeId] ?? {
                            pairingQr: '',
                            pairingManualCode: '',
                        }),
                        status: `Löschen fehlgeschlagen: ${message}`,
                    },
                },
            }));
        }
    };

    private reopenBridgeCommissioning = async (bridgeId: string): Promise<void> => {
        const connection = this.props as ConfigGenericProps & {
            socket: AdminConnection;
            adapterName: string;
            instance: number | string;
        };

        const target = `${connection.adapterName}.${connection.instance}`;

        this.setState(state => ({
            bridgeRuntime: {
                ...state.bridgeRuntime,
                [bridgeId]: {
                    ...(state.bridgeRuntime[bridgeId] ?? { pairingQr: '', pairingManualCode: '' }),
                    status: 'Pairing wird erneut gestartet …',
                },
            },
        }));

        try {
            const result = await connection.socket.sendTo(
                target,
                'reopenCommissioning',
                { bridgeId },
            ) as { ok?: boolean; error?: string };

            console.info('[matter-bridge-slim] sendTo Promise response:', result);

            if (!result?.ok) {
                throw new Error(result?.error || 'Keine Bestätigung vom Adapter erhalten.');
            }

            await this.refreshBridgeRuntime(bridgeId);

            this.setState(state => ({
                bridgeRuntime: {
                    ...state.bridgeRuntime,
                    [bridgeId]: {
                        ...(state.bridgeRuntime[bridgeId] ?? { pairingQr: '', pairingManualCode: '' }),
                        status: 'Commissioning-Modus erneut geöffnet.',
                    },
                },
            }));
        } catch (error) {
            this.setState(state => ({
                bridgeRuntime: {
                    ...state.bridgeRuntime,
                    [bridgeId]: {
                        ...(state.bridgeRuntime[bridgeId] ?? { pairingQr: '', pairingManualCode: '' }),
                        status: `Pairing-Neustart fehlgeschlagen: ${String(error)}`,
                    },
                },
            }));
        }
    };

    private openSelectId = (target: 'stateId' | 'brightnessStateId'): void => {
        this.setState({ showSelectId: true, selectIdTarget: target });
    };

    private getSelectedDeviceDefinition() {
        return DEVICE_TYPE_REGISTRY[this.state.deviceDraft.type];
    }

    private getAdditionalStateFields() {
        return this.getSelectedDeviceDefinition().additionalStateFields;
    }

    private renderSelectIdDialog(): React.JSX.Element | null {
        if (!this.state.showSelectId) {
            return null;
        }

        const pickerProps = this.props as ConfigGenericProps & {
            socket: AdminConnection;
            theme: IobTheme;
            themeType: 'dark' | 'light';
            adapterName: string;
        };

        return (
            <DialogSelectID
                imagePrefix="../.."
                dialogName={pickerProps.adapterName}
                theme={pickerProps.theme}
                themeType={pickerProps.themeType}
                socket={pickerProps.socket}
                types={['state']}
                selected={this.state.deviceDraft[this.state.selectIdTarget] || ''}
                onClose={() => this.setState({ showSelectId: false })}
                onOk={(selected, _name) => {
                    this.setState(state => ({
                        showSelectId: false,
                        deviceDraft: {
                            ...state.deviceDraft,
                            [state.selectIdTarget]: selected as string,
                        },
                    }));
                }}
            />
        );
    }

    private addBridge = (): void => {
        const draft = this.state.bridgeDraft;
        const bridges = this.readArray<Bridge>('bridges');
        const duplicateBridgeId = !!draft.id.trim() &&
            bridges.some(item => item.id === draft.id.trim());

        if (!draft.id.trim() || !draft.name.trim() || duplicateBridgeId) {
            return;
        }

        const port = Number(draft.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return;

        this.updateBridges([...bridges, { ...draft, id: draft.id.trim(), name: draft.name.trim(), port }]);
        this.setState({ bridgeDraft: { ...emptyBridge(), port: port + 1 } });
    };

    private addDevice = (): void => {
        const draft = this.state.deviceDraft;
        const bridges = this.readArray<Bridge>('bridges');
        const devices = this.readArray<Device>('devices');

        if (
            bridges.length === 0 ||
            !draft.id.trim() ||
            !draft.name.trim() ||
            !draft.bridgeId ||
            !bridges.some(item => item.id === draft.bridgeId) ||
            !draft.stateId.trim() ||
            devices.some(item => item.id === draft.id.trim())
        ) {
            return;
        }

        if (this.getAdditionalStateFields().some(field =>
            field.required && !String(draft[field.key] ?? '').trim()
        )) return;

        this.updateDevices([
            ...devices,
            {
                ...draft,
                id: draft.id.trim(),
                name: draft.name.trim(),
                stateId: draft.stateId.trim(),
                ...Object.fromEntries(
                    this.getAdditionalStateFields().map(field => [
                        field.key,
                        String(draft[field.key] ?? '').trim(),
                    ]),
                ),
            },
        ]);
        this.setState(state => ({
            deviceDraft: { ...emptyDevice(), bridgeId: state.deviceDraft.bridgeId },
        }));
    };

    renderItem(_error: string, _disabled: boolean, _defaultValue?: unknown): React.JSX.Element {
        const bridges = this.readArray<Bridge>('bridges');
        const devices = this.readArray<Device>('devices');

        return (
            <Stack spacing={2} sx={{ width: '100%', p: 1 }}>
                <Typography variant="h5">Matter Bridge Slim</Typography>
                <Typography color="text.secondary">
                    Verwandelt ioBroker-States in Matter-Geräte und stellt sie anderen Matter-Systemen zur Verfügung.
                </Typography>

                <Divider />
                <Typography variant="h6">Bridges</Typography>

                {bridges.map(bridge => (
                    <Card variant="outlined" key={bridge.id}>
                        <CardContent>
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                                <BoxText label="Name" value={bridge.name} />
                                <BoxText label="ID" value={bridge.id} />
                                <BoxText label="Port" value={String(bridge.port)} />
                                <Button onClick={() => void this.refreshBridgeRuntime(bridge.id)}>
                                    Status / Pairing laden
                                </Button>
                                <Button
                                    variant="outlined"
                                    onClick={() => void this.reopenBridgeCommissioning(bridge.id)}
                                >
                                    Pairing erneut starten
                                </Button>
                                {this.state.bridgeRuntime[bridge.id] && (
                                    <Stack spacing={0.5} sx={{ minWidth: 220, overflowWrap: 'anywhere' }}>
                                        <Typography
                                            variant="body2"
                                            sx={{ overflowWrap: 'anywhere', minWidth: 0 }}
                                        >
                                            Status: {this.state.bridgeRuntime[bridge.id].status}
                                        </Typography>
                                        <Typography variant="body2">
                                            Matter gekoppelt: {this.state.bridgeRuntime[bridge.id].commissioned ? 'Ja' : 'Nein'}
                                        </Typography>
                                        <Typography variant="body2">
                                            Fabrics: {this.state.bridgeRuntime[bridge.id].fabricCount}
                                        </Typography>
                                        {this.state.bridgeRuntime[bridge.id].pairingQr ? (
                                            <QRCode
                                                value={this.state.bridgeRuntime[bridge.id].pairingQr}
                                                size={180}
                                                title={`Matter-Pairing für ${bridge.name}`}
                                                style={{ maxWidth: '100%', height: 'auto' }}
                                            />
                                        ) : (
                                            <Typography variant="body2">Nicht verfügbar</Typography>
                                        )}
                                        <Typography variant="caption" color="text.secondary">
                                            Manueller Pairing-Code
                                        </Typography>
                                        <Typography variant="body2">
                                            {this.state.bridgeRuntime[bridge.id].pairingManualCode || 'Nicht verfügbar'}
                                        </Typography>
                                    </Stack>
                                )}
                                <Button
                                    color="error"
                                    onClick={() => void this.deleteBridge(bridge.id)}
                                >
                                    Bridge und Matter-Daten endgültig löschen
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>
                ))}

                {bridges.length === 0 && (
                    <>
                <Card variant="outlined">
                    <CardContent>
                        <Typography variant="subtitle1">Bridge hinzufügen</Typography>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1 }}>
                            <TextField
                                label="Bridge ID"
                                sx={{ width: 160, flexShrink: 0 }}
                                value={this.state.bridgeDraft.id}
                                onChange={event => this.updateBridgeDraft('id', event.target.value)}
                                error={!!this.state.bridgeDraft.id.trim() &&
                                    this.readArray<Bridge>('bridges').some(
                                        item => item.id === this.state.bridgeDraft.id.trim()
                                    )}
                                helperText={
                                    !!this.state.bridgeDraft.id.trim() &&
                                    this.readArray<Bridge>('bridges').some(
                                        item => item.id === this.state.bridgeDraft.id.trim()
                                    )
                                        ? 'Diese Bridge-ID wird bereits verwendet.'
                                        : 'Die Bridge-ID muss eindeutig sein.'
                                }
                            />
                            <TextField label="Anzeigename" value={this.state.bridgeDraft.name}
                                sx={{ width: 300, flexShrink: 0 }}
                                onChange={event => this.updateBridgeDraft('name', event.target.value)} />
                            <TextField label="Matter-Port" type="number" value={this.state.bridgeDraft.port}
                                onChange={event => this.updateBridgeDraft('port', event.target.value)} />
                            <Button variant="contained" onClick={this.addBridge}>Hinzufügen</Button>
                        </Stack>
                    </CardContent>
                </Card>

                    </>
                )}
                <Divider />
                <Typography variant="h6">Geräte</Typography>

                {devices.map(device => (
                    <Card variant="outlined" key={device.id}>
                        <CardContent>
                            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                                <BoxText label="Name" value={device.name} />
                                <BoxText label="ID" value={device.id} />
                                <BoxText label="Typ" value={DEVICE_TYPE_REGISTRY[device.type]?.label ?? device.type} />
                                <BoxText label="Bridge" value={device.bridgeId} />
                                <BoxText
                                    label={DEVICE_TYPE_REGISTRY[device.type]?.stateLabel ?? 'State-ID'}
                                    value={device.stateId}
                                />
                                {DEVICE_TYPE_REGISTRY[device.type]?.additionalStateFields.map(field => (
                                    <BoxText
                                        key={field.key}
                                        label={field.label}
                                        value={String(device[field.key] ?? '')}
                                    />
                                ))}
                                <Button color="error" onClick={() =>
                                    this.updateDevices(devices.filter(item => item.id !== device.id))
                                }>
                                    Entfernen
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>
                ))}

                {bridges.length === 0 && (
                    <Alert severity="info">Lege zuerst mindestens eine Bridge an, bevor du Geräte zuordnest.</Alert>
                )}

                <Card variant="outlined">
                    <CardContent>
                        <Typography variant="subtitle1">Gerät hinzufügen</Typography>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1 }}>
                            <TextField
                                disabled={bridges.length === 0}
                                label="Geräte-ID"
                                sx={{ width: 160, flexShrink: 0 }}
                                value={this.state.deviceDraft.id}
                                onChange={event => this.updateDeviceDraft('id', event.target.value)}
                                error={!!this.state.deviceDraft.id.trim() && devices.some(
                                    item => item.id === this.state.deviceDraft.id.trim()
                                )}
                                helperText={
                                    !!this.state.deviceDraft.id.trim() && devices.some(
                                        item => item.id === this.state.deviceDraft.id.trim()
                                    )
                                        ? 'Diese Geräte-ID wird bereits verwendet.'
                                        : 'Die Geräte-ID muss adapterweit eindeutig sein.'
                                }
                            />
                            <TextField
                                disabled={bridges.length === 0}
                                label="Anzeigename"
                                value={this.state.deviceDraft.name}
                                sx={{ width: 300, flexShrink: 0 }}
                                onChange={event => this.updateDeviceDraft('name', event.target.value)}
                            />
                            <TextField
                                select
                                disabled={bridges.length === 0}
                                label="Bridge"
                                value={this.state.deviceDraft.bridgeId}
                                onChange={event => this.updateDeviceDraft('bridgeId', event.target.value)}
                                sx={{ minWidth: 160 }}>
                                {bridges.map(bridge => (
                                    <MenuItem key={bridge.id} value={bridge.id}>{bridge.name} ({bridge.id})</MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                select
                                disabled={bridges.length === 0}
                                label="Gerätetyp"
                                value={this.state.deviceDraft.type}
                                onChange={event => this.updateDeviceDraft('type', event.target.value)}
                                sx={{ minWidth: 180 }}>
                                {Object.entries(DEVICE_TYPE_REGISTRY).map(([type, definition]) => (
                                    <MenuItem key={type} value={type}>{definition.label}</MenuItem>
                                ))}
                            </TextField>
                        </Stack>
                        {this.state.deviceDraft.type === 'humiditySensor' && (
                            <Alert severity="info" sx={{ mt: 1 }}>
                                Hinweis zu Amazon Alexa: Bei Luftfeuchtigkeitssensoren kann Alexa
                                den Messwert möglicherweise nicht korrekt anzeigen. In Apple Home
                                kann der Sensor dennoch ordnungsgemäß funktionieren. Die Ursache
                                kann in der Alexa-Kompatibilität liegen und ist nicht zwangsläufig
                                ein Fehler des Adapters.
                            </Alert>
                        )}
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mt: 1 }}>
                            <TextField
                                fullWidth
                                disabled={bridges.length === 0}
                                label={this.getSelectedDeviceDefinition().stateLabel}
                                value={this.state.deviceDraft.stateId}
                                onChange={event => this.updateDeviceDraft('stateId', event.target.value)}
                                helperText="ID manuell eingeben oder über den Objektbaum auswählen."
                            />
                            <Button
                                variant="outlined"
                                disabled={bridges.length === 0}
                                onClick={() => this.openSelectId('stateId')}
                            >
                                Objekt auswählen
                            </Button>
                            {this.getAdditionalStateFields().map(field => (
                                <React.Fragment key={field.key}>
                                    <TextField
                                        fullWidth
                                        disabled={bridges.length === 0}
                                        required={field.required}
                                        label={field.inputLabel}
                                        value={this.state.deviceDraft[field.key] || ''}
                                        onChange={event => this.updateDeviceDraft(
                                            field.key as keyof Device,
                                            event.target.value,
                                        )}
                                    />
                                    {field.key === 'brightnessStateId' && (
                                        <Button
                                            variant="outlined"
                                            disabled={bridges.length === 0}
                                            onClick={() => this.openSelectId('brightnessStateId')}
                                        >
                                            {field.pickerLabel}
                                        </Button>
                                    )}
                                </React.Fragment>
                            ))}
                            <Button
                                variant="contained"
                                onClick={this.addDevice}
                                disabled={
                                    bridges.length === 0 ||
                                    !this.state.deviceDraft.id.trim() ||
                                    !this.state.deviceDraft.name.trim() ||
                                    !this.state.deviceDraft.bridgeId ||
                                    !this.state.deviceDraft.stateId.trim() ||
                                    devices.some(item => item.id === this.state.deviceDraft.id.trim()) ||
                                    this.getAdditionalStateFields().some(field =>
                                        field.required &&
                                        !String(this.state.deviceDraft[field.key] ?? '').trim()
                                    )
                                }
                            >
                                Gerät hinzufügen
                            </Button>
                        </Stack>
                    </CardContent>
                </Card>


                {this.renderSelectIdDialog()}
            </Stack>
        );
    }
}

function BoxText({ label, value }: { label: string; value: string }): React.JSX.Element {
    return (
        <Stack spacing={0.25} sx={{ minWidth: 100, maxWidth: '100%', overflowWrap: 'anywhere' }}>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
            <Typography variant="body2">{value}</Typography>
        </Stack>
    );
}
