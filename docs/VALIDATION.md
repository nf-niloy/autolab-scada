# AutoLab SCADA acceptance checklist

## Frontend, no Arduino needed

- [ ] GitHub Pages public page loads in the browser; two-stage Welcome → Dashboard, Recipes and History work on desktop and mobile, with no text/line overlap in sensor cards.
- [ ] Color palette matches `#F5D5E0`, `#6667AB`, `#7B337E`, `#420D4B`, `#210635` in both theme variations.
- [ ] Theme toggle switches instantly and persists across reloads.
- [ ] Without local backend, DEMO MODE is shown and switches/recipes operate only on synthetic data.
- [ ] Saved demo recipes and history survive a reload; exported JSON and CSV identify `SIMULATED` source.

## Connection / authorization

- [ ] Backend starts on loopback only; terminal shows a **new** six-digit pairing code on each start.
- [ ] GitHub Pages tab requests permission for local/loopback network access if needed; user allows it.
- [ ] With Arduino serial telemetry fresh, welcome indicates **SYSTEM LIVE** and authorized users can enter the hardware workspace.
- [ ] Real DS18B20 and MLX90614 numbers are shown, and graph updates.
- [ ] Motor/Fan switches are disabled before pairing and an explicit Unlock Controls button is available.
- [ ] Incorrect code fails; correct code enables controls. Unauthorized API commands fail 401, malicious Origin fails 403.
- [ ] Hardware motor and fan are never shown as verified physical contact feedback.
- [ ] On USB/backend loss, UI stops showing stale hardware readings as live and warns that physical state is unknown.

## Hardware tests — only with safe physical setup

- [ ] Motor ON/OFF, Fan ON/OFF and STOP through website behave as Arduino commanded; physically monitor actual equipment.
- [ ] Attempts to command both motor and fan ON simultaneously are rejected.
- [ ] A 3-stage recipe cycles correctly with real state changes; pause/resume and manual STOP verified.
- [ ] After run completion, Arduino events and SQLite history are available.
- [ ] Physical emergency power cutoff is accessible; no web UI is treated as a certified emergency stop.

## Developer test commands

```
python -m unittest tests.test_v3_backend
node tests/test_v3_frontend.mjs
node --check src/app.js
```

Unit tests cover API allowlist, pairing, CSRF protection, validation and the frontend adapter, but **do not substitute** for browser-local network permission or real hardware tests. The test environment may prohibit browser navigation and should not be presented as verified browser/physical results.
