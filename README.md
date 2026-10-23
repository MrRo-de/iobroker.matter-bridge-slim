# Matter Bridge Slim

A lightweight, local Matter bridge adapter for ioBroker.

Matter Bridge Slim exposes configured ioBroker states to a Matter-compatible
controller, allowing supported devices to be controlled or monitored through
a Matter ecosystem.

**Project status:** Early development. Compatibility and behavior may vary
depending on the Matter controller and the devices being bridged.

## Features

- A Matter bridge for ioBroker.
- Configurable bridge ports (default: `5540`).
- State-based device configuration using ioBroker state IDs.
- Supported device types:
  - Switch
  - Dimmable light with brightness state
  - Temperature sensor
  - Relative humidity sensor
- Local operation without a required cloud service.
- Pairing information displayed in the adapter administration interface.

## Requirements

- A working ioBroker installation.
- A Node.js version supported by the installed ioBroker controller.
- Node.js 22 is used for this project's development and build environment.
- A Matter-compatible controller for commissioning and controlling the bridge.

The project has been tested in a development environment with ioBroker
7.2.5 and Admin 8.2.0. This does not guarantee compatibility with every
ioBroker, Node.js, operating system, or Matter-controller version.

## Build from source

```bash
npm install
npm run build
```

The build generates the adapter runtime and administration files.

To create an installable package:

```bash
npm pack
```

Install the resulting package on a test ioBroker system using the
appropriate ioBroker adapter installation procedure.

## Configuration

Create one bridge in the adapter administration interface. The bridge
bridge has an ID, a name, and a Matter port. Add devices to a bridge and
select the relevant ioBroker state IDs.

Device configuration depends on the selected type:

- **Switch:** a state representing the on/off value.
- **Dimmable light:** an on/off state and a brightness state.
- **Temperature sensor:** a state containing temperature in degrees Celsius.
- **Humidity sensor:** a state containing relative humidity as a percentage.

Use valid, existing state IDs and ensure that their values match the
expected type and range.

## Troubleshooting

- Confirm that the adapter instance is running.
- Ensure that each bridge uses a free port.
- Verify that configured state IDs exist and contain suitable values.
- Check the ioBroker logs and the Matter controller's commissioning status.
- Matter commissioning depends on network discovery and controller
  compatibility; a running adapter alone does not guarantee successful pairing.

## License

Matter Bridge Slim is provided under the
[Non-Commercial License](LICENSE).

Free non-commercial use and free redistribution are permitted under the
license terms. Commercial use requires prior written permission from the
copyright holder.
