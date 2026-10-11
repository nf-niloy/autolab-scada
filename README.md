# AutoLab SCADA v2 — Demo + Local Live Mode

An industrial-style automation workspace with a responsive browser simulator and an optional **same-origin local Arduino hardware mode**. Use Arduino Uno, DS18B20, MLX90614, motor/fan relays and a 16×2 LCD with the previously tested AutoLab firmware.

## Two deliberately separate deployments

| Public GitHub Pages site | Local PC with USB-connected Arduino |
| --- | --- |
| Browser Demo Mode ONLY; simulated actuators and synthetic temperature data | Demo Mode **or** operator-enabled Live Mode |
| Fully static HTML/CSS/JavaScript | Python FastAPI + PySerial + SQLite |
| No dependencies, no build step | Requires Python dependencies and connected COM port |
| Cannot control real equipment | Real relay-control commands via same-origin local API |

**Do not enable hardware control on GitHub Pages or expose your FastAPI actuator endpoints on the public internet.**

## Local hardware — Windows

1. Close Arduino IDE Serial Monitor / `serial_test.py` (they compete for the port).
2. Install the Python dependencies:

   ```cmd
   cd /d D:\autolab-scada
   python -m pip install -r backend\requirements.txt
   ```
3. Plug in Arduino Uno on `COM6` and verify motor/fan wiring and independent 12V power isolation.
4. Double-click **`run_live.bat`** (or run `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`).
5. Open **http://127.0.0.1:8000/** and click **Connect Arduino** in the top bar.
6. Verify real temperatures first; test each actuator briefly, then a 3-step recipe. In Live Mode the recipe editor enforces **8 steps max / 120 seconds per step**.

**Important:** Browser STOP is not an industrial emergency stop. Switching from Live to Demo sends STOP first. If the PC or USB link fails the Arduino firmware watchdog should de-energize outputs, but a physical cutoff must always be accessible. Physical relays must be checked independently from commanded states.

See [`docs/LIVE_MODE.md`](docs/LIVE_MODE.md) for details, diagnostics and instructions for changing COM port.

## Public demo — GitHub Pages

Push the repository to GitHub, then Settings → Pages → `main` / `(root)`.

GitHub Pages serves `index.html` and the `src/`/`assets/` folders statically. The local control switch remains hidden on GitHub Pages. Your personal portfolio does not need to be changed; add the separate GitHub Pages project link later.

For a local **demo only**, run `run_local.bat` (the static server on port 8000). For **real hardware**, run `run_live.bat`, never both at the same time.

## Features

- Overview, Control Room, Recipe Studio, Analytics, Run History, System & Setup
- Demo simulation: independent synthetic sensor traces, manual commands, recipes, pause/resume, fault injection, browser-local results and exports
- Local Live Mode: actual DS18B20/MLX90614 measurements, motor/fan commands, start/pause/resume/stop recipes, connection freshness, Arduino event feed
- SQLite measured telemetry, persisted real run metadata, firmware event timestamps, hardware CSV and per-run export
- No public hardware control; local-only HTTP and WebSocket

## Data distinction

- **SIMULATED**: Browser demo values, event timings and simulation history
- **HARDWARE**: Arduino-reported sensor readings, firmware timestamped events and commanded output states
- No independent relay-contact measurement, RPM, current, power or precise thermal coefficient estimation

## Project structure

```text
index.html
src/app.js               UI / mode switch / event handlers
src/live-controller.js   Same-origin local API + WebSocket adapter
src/simulator.js         Unchanged simulation engine
src/recipes.js           Demo recipe rules (hardware rules validated separately)
src/charts.js            SVG charts supporting unavailable sensor values
assets/styles.css        Responsive interface and mode selector
backend/main.py          FastAPI + PySerial + SQLite + local UI serving
backend/requirements.txt
run_local.bat             Demo only
run_live.bat              Local Arduino bridge
```

The original hardware firmware is not included: keep using your **currently tested and timing-fixed** Arduino Uno firmware. Replace it only after a separate validated firmware change.
