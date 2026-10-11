# AutoLab SCADA

**A practical Arduino-based laboratory automation and monitoring workspace.**

AutoLab SCADA combines a browser-based supervisory interface, a programmable Arduino controller, and a Python gateway into one experimental system. It supports **live temperature monitoring**, **manual motor and fan control**, **timed automation recipes**, and **recorded experiments**. A fully independent simulator lets anyone explore the interface without physical hardware.

> **Project by Nafiz Fuad Niloy.** Developed as an educational laboratory automation prototype. It is **not** a certified industrial SCADA or safety system.

![AutoLab SCADA welcome screen](docs/preview-welcome.png)

## At a glance

| Feature | Public demo | Private Arduino workspace |
| --- | --- | --- |
| Browser welcome screen | Open without login | Enter a six-digit local pairing code |
| Contact and IR temperature | Clearly labeled synthetic readings | Measured DS18B20 and MLX90614 readings |
| Motor and fan switches | Browser-only simulated outputs | Arduino relay output commands |
| Programmable timed recipes | Browser timing engine | Arduino firmware timing engine |
| Events and trends | Simulated activity and charts | Arduino events and measured telemetry |
| Experiment history | Browser `localStorage` | Local SQLite database |
| Light/dark themes | Yes | Yes |
| CSV/JSON export | Yes | Yes, where supported by the view |

![AutoLab SCADA dashboard in demonstration mode](docs/preview-dashboard.png)

## Why this project exists

Many small laboratory experiments need repeatable actuator sequences and a convenient view of sensor values, but do not require a full-scale industrial SCADA installation. AutoLab SCADA explores that middle ground using commonly available hardware and lightweight, inspectable software.

The application separates **monitoring** (sensor readings, status, trends), **supervisory operation** (start/stop, manual outputs, recipes) and **recordkeeping** (event timestamps, sample history). It is intended for learning about process automation, microcontroller communication, measurement and experimental repeatability.

## Interface and workflow

**Screen 1 — Welcome and access.** Visitors can choose **Open demo** immediately. If the local backend and Arduino are ready, the owner can enter a private six-digit code to access the real control room. Backend presence alone does **not** authorize physical control.

**Screen 2 — Workspace.** The application exposes three focused views:

- **Overview:** measured/simulated temperature cards, relay command indicators, output switches, STOP, process progress, a scrolling trend chart and activity log.
- **Recipes:** a step editor with motor/fan selection, duration, repeat count, saved presets and run control.
- **Run history:** previous sessions and associated timing information, with exports where available.

The interface uses a five-color **Moon palette** (`#F5D5E0`, `#6667AB`, `#7B337E`, `#420D4B`, `#210635`), responsive layouts, a light/dark appearance switch, and separate data-source labels. Preferences and demo recipes are saved locally in the browser.

## Hardware

The project was built around the existing Arduino laboratory hardware rather than requiring new equipment.

| Component | Connection / role |
| --- | --- |
| Arduino Uno | Serial controller at 115200 baud over USB |
| DS18B20 | Contact-temperature sensor, 1-Wire at **D2** |
| MLX90614 | Non-contact infrared temperature sensor, **I²C** |
| 16×2 I²C LCD | Local status display on shared I²C bus |
| DC motor relay | Command output at **D7** |
| Fan relay | Command output at **D6** |
| 12 V motor and fan | Independently powered loads controlled through relays |
| Buzzer | Hardware-specific pin; **verify wiring and firmware** before use |

**Important:** The referenced hardware report contains a buzzer pin discrepancy (D8 versus D11). Relay trigger polarity, wiring, contact ratings, motor inductive protection, grounding and I²C pull-up voltage compatibility must be checked on the actual setup. This repository does **not** by itself establish the safety of any external wiring.

The UI displays *commanded* relay states. It cannot prove that a relay contact moved, a motor rotated, or a fan produced airflow; those measurements would require separate feedback hardware. Likewise, contact and IR sensors need not measure exactly the same physical temperature.

## Architecture

```text
                        GitHub Pages (static frontend)
                        ┌─────────────────────────┐
                        │ Welcome / Demo / Login  │
                        │ Dashboard & visual tools│
                        └────────────┬────────────┘
                                     │ optional, paired local session
                                     ▼
              Operator's PC: http://127.0.0.1:8000
                        ┌─────────────────────────┐
                        │ Python FastAPI gateway  │
                        │ Pairing + request checks│
                        │ SQLite sample historian │
                        └────────────┬────────────┘
                                     │ PySerial at 115200 baud
                                     ▼
                        ┌─────────────────────────┐
                        │ Arduino Uno firmware    │
                        │ Sensors, timers, relays │
                        │ Interlock and watchdog  │
                        └─────────────────────────┘

Demo path: Web browser → independent JS simulator → browser localStorage.
```

The static frontend **cannot run Python on GitHub Pages** and cannot control a USB Arduino by itself. To use real hardware from GitHub Pages, the user must be on the Arduino-connected computer with the local bridge running, and their browser must permit access to the local loopback service. When that permission is unavailable, use the same UI directly at `http://127.0.0.1:8000`.

### Technology stack

- **Frontend:** HTML, modern CSS, vanilla JavaScript ES modules and inline SVG charts; no front-end build framework required.
- **Demo engine:** an independent browser state machine with synthetic channels, recipe timers and local history.
- **Local API:** Python, FastAPI, Uvicorn, Pydantic, PySerial and WebSocket support.
- **Storage:** SQLite for hardware telemetry, firmware events, steps and runs; `localStorage` for demo data and appearance preferences.
- **Controller:** Arduino serial protocol with framed commands, acknowledgements, telemetry and events.

## Run the demo

**Online:** [AutoLab SCADA on GitHub Pages](https://nf-niloy.github.io/autolab-scada/).

**Locally (frontend only):**

```powershell
cd D:\autolab-scada
python -m http.server 8001
```

Open `http://127.0.0.1:8001` and select **Open demo**. Use a web server instead of double-clicking `index.html`, because the frontend uses ES modules. Alternatively, run `run_local.bat` on Windows or `./run_local.sh` on Linux/macOS to start a local preview at `http://127.0.0.1:8765`.

In demo mode, the motor/fan actions, temperatures and recorded timings are **simulated** and do not connect to physical equipment. You can build recipes and export illustrative traces without a backend.

## Connect a real Arduino (Windows)

**Prerequisites:** a connected and correctly configured Arduino with compatible AutoLab serial firmware, Python 3.10+ and an available USB COM port. Close the Arduino Serial Monitor and other applications using that COM port.

1. Back up your working project folder and **keep your existing SQLite database**.
2. In PowerShell, install the local gateway dependencies:

   ```powershell
   cd D:\autolab-scada\backend
   python -m pip install -r requirements.txt
   ```

3. Start the gateway, bound **only** to the local computer:

   ```powershell
   python -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```

   Or double-click `run_live.bat` from the project folder.

4. If your Arduino is not on the default `COM6`, set the port before starting:

   ```powershell
   $env:ARDUINO_PORT = 'COM5'   # replace with your actual port
   python -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```

5. Open `http://127.0.0.1:8000` (or the GitHub Pages site **on that same computer**). The welcome screen shows whether the local backend and Arduino are ready.
6. Choose the private-control path. Enter the **six-digit pairing code** displayed in your own backend terminal. **Never publish or screenshot the code.**
7. Verify sensor readings and status **before** running manual outputs or any recipe. Keep a physical power cutoff available throughout the experiment.

Backend requests include `GET /api/status`, `GET /api/history`, `GET /api/runs`, read-only WebSocket `/ws/live`, and authenticated output/recipe commands such as `POST /api/motor`, `/api/fan`, `/api/stop` and `/api/recipe/run`. Interactive API documentation is available at `/docs` when the local server is running. Avoid issuing hardware commands unless you understand their effect.

### Recipe bounds

| Constraint | Demo | Hardware |
| --- | --- | --- |
| Steps per recipe | 1–12 | 1–8 |
| Duration per step | 2–180 seconds | 2–120 seconds |
| Repeat cycles | 1–5 | 1–20 |
| Motor and fan simultaneously ON | Blocked | Blocked |

Live recipes are sent to the Arduino for execution; browser scheduling does not determine the firmware's step timing. Event-derived step intervals are **not** measurements of relay contacts or mechanical response.

## Security and operational safety

The backend is intentionally designed for **local-only use**, not internet-facing deployment.

- The backend binds to `127.0.0.1` and checks permitted hosts and a specific GitHub Pages origin.
- A private short pairing code, rate-limited attempts and a time-limited bearer authorization gate hardware writes. Restarting the backend changes its code and token.
- The code stays in the user's local backend terminal and is never committed to the GitHub Pages repository.
- A browser's Local Network Access permission is distinct from control authorization: users must still pair before any physical output is available.
- Connection loss disables the frontend's live controls, but does **not** establish that an actual load has stopped. Check the hardware directly.
- The Arduino should independently enforce output startup-OFF, relay interlock, bounded recipes and watchdog shutdown. The frontend must not be trusted as a safety controller.
- **STOP in the browser is not a certified emergency stop.** Keep an accessible physical power cutoff, and do not operate unattended or hazardous equipment from this prototype.

Do not change the backend binding to `0.0.0.0`, publish it behind a reverse proxy, or expose a USB controller through an unauthenticated API.

## Data and exports

The hardware database defaults to `backend/autolab_history.sqlite3`. It stores readings, Arduino event records, recipes/runs and step intervals. Back it up separately before making deployment changes. The repository's `.gitignore` excludes SQLite files and local configuration so experimental data and private files are not accidentally committed.

Demo runs, saved recipes and theme preference are browser-local. Clearing browser site data can remove them. The frontend's CSV export identifies whether values came from **SIMULATED** or **HARDWARE** sources; never describe simulated values as experimental measurements.

## Repository structure

```text
index.html                  Two-screen HTML shell and branding
assets/styles.css           Responsive Moon-palette light/dark interface
assets/favicon.svg          AutoLab identity mark
src/app.js                  Pages, actions, recipe editor, data presentation
src/live-controller.js      Paired local API adapter and live state
src/simulator.js            Independent demo state machine
src/recipes.js              Demo recipes and validation
src/charts.js               Temperature trends and sparklines
src/storage.js              Browser persistence and exports
src/icons.js                Interface SVG icons
backend/main.py             FastAPI, serial bridge, historian, pairing
backend/requirements.txt    Python dependencies
run_live.bat                 Start local hardware bridge (Windows)
run_local.bat / run_local.sh Static demo launch scripts
docs/                       Setup, validation and design previews
tests/                      Backend and frontend regression checks
```

## Testing and validation

From the project root:

```powershell
python -m unittest discover -s tests
node tests/test_frontend.mjs
node tests/test_autolab_ui.mjs
node --check src/app.js
```

Browser smoke tests can validate visual layout, demo navigation, theme switching and pairing with **mocked** backend responses. The local Arduino communication, relay response and GitHub Pages loopback permission path must be rechecked on the intended computer after a new deployment. See [Validation checklist](docs/VALIDATION.md).

## Troubleshooting

| Symptom | Likely cause / action |
| --- | --- |
| Welcome page says Arduino offline | Confirm USB cable, correct `ARDUINO_PORT`, uploaded firmware and that Serial Monitor is closed |
| Dashboard shows simulated temperatures | You selected **Open demo**; choose private control from the welcome screen to use measured data |
| Control remains unavailable | Check backend terminal, pairing code, fresh `/api/status` telemetry and authorization |
| Public GitHub Pages cannot detect local server | Allow local-network access when prompted, verify `http://127.0.0.1:8000/api/status`, or use the local URL |
| `No supported WebSocket library detected` | Install dependencies with `python -m pip install -r backend/requirements.txt` |
| Database appears missing after an update | Look for the previous `backend/autolab_history.sqlite3` backup; don't commit or overwrite it |
| Two conflicting motor/fan commands | Interlock intentionally prevents both channels being ON simultaneously |

## Credits

**Created by [Nafiz Fuad Niloy](https://github.com/nf-niloy).**

Built around an Arduino-based laboratory project and expanded into an interactive simulation and a local hardware monitoring/control interface. Demo and private live operating modes intentionally share a visual language while keeping their data sources and control paths separate.
