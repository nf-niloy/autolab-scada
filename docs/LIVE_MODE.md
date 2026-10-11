# AutoLab SCADA v2 — Local Arduino Live Mode

## Safety boundary

- **GitHub Pages is DEMO ONLY.** No public Arduino control and no localhost bridge calls from the public site.
- **Real hardware controls are available only from `http://127.0.0.1:8000/`** on the laptop connected by USB. The server must bind to `127.0.0.1`, not `0.0.0.0`.
- A browser STOP button is **not an emergency-stop circuit**. Keep independent physical power isolation accessible. Verify relay polarity, power supply and inductive-load protection before operating a motor/fan.
- The frontend reports **Arduino-commanded relay output states**, not measured contact closure, RPM or current.
- Live temperature values are **measured**, Demo Mode sensor values are **simulated**. Each mode is labeled.

## One-time setup — Windows

1. Back up `D:\autolab-scada` before copying updated files. Keep your `backend/autolab_history.sqlite3` database.
2. Copy the v2 ZIP contents into `D:\autolab-scada`, replacing existing `src/`, `assets/`, `index.html`, `backend/main.py`, and docs files. **Do not delete your old database.**
3. Open CMD in `D:\autolab-scada` and install: `python -m pip install -r backend\requirements.txt`.
4. Confirm Arduino Uno is plugged in, `COM6` is correct, Arduino IDE Serial Monitor is closed, and no `serial_test.py` process is running.
5. Run `run_live.bat` or: `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` from `D:\autolab-scada`.
6. Browse **http://127.0.0.1:8000/**. It starts in Demo Mode. The header offers **Connect Arduino**. Confirm to enter Live Mode.
7. Start with outputs OFF. Check DS18B20 and MLX90614 readings. Test motor/fan manually for a few seconds. Then try a short recipe.
8. Return to Demo Mode only after the requested hardware STOP is acknowledged. If communication is lost, physically disconnect actuator power and recover the controller safely.

## If the port changes

PowerShell:

```powershell
$env:ARDUINO_PORT = 'COM7'
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

CMD:

```cmd
set ARDUINO_PORT=COM7
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Validation and event timing

API endpoints under `/docs` remain available for diagnostics. SQLite stores telemetry, events, runs and firmware step timestamps. The original telemetry table is preserved and extended by new `events`, `runs` and `run_steps` tables. Complete recipe timings are derived from successive Arduino `EVENT,...,STEP` and `EVENT,...,RUN_COMPLETE` uptime timestamps; they measure **firmware intervals**, not physical relay closure.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/status` | USB + fresh telemetry + active recipe + recent events |
| `GET /api/history` | Recorded measured telemetry |
| `GET /api/runs` | Real process run summaries |
| `GET /api/runs/{id}` | Run detail including measured samples + firmware step timings |
| `GET /api/export/telemetry.csv` | Recorded telemetry CSV |
| `POST /api/motor` | Manual motor output request |
| `POST /api/fan` | Manual fan output request |
| `POST /api/stop` | Request both outputs OFF |
| `POST /api/reset` | Controller-state reset (not hardware reboot) |
| `POST /api/recipe/run` | Upload and run 1–8 steps, 2–120 s each, 1–20 cycles |
| `POST /api/recipe/pause` | Pause ongoing process |
| `POST /api/recipe/resume` | Resume paused process |
| `WS /ws/live` | Fresh telemetry/status broadcasts |

### Limitations

The new backend code and browser Live Mode integration have been verified syntactically and with mock tests in the authoring environment. **Physical end-to-end verification must be repeated on your Windows laptop.** Your earlier serial bridge/firmware tests do not automatically verify this revised backend. Do not assume this is a production-ready industrial safety system.
