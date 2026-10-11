# AutoLab SCADA · Public-page-to-local Arduino mode

## Intended workflow

1. Serve the frontend as a static GitHub Pages site (HTTPS).
2. Start the FastAPI + PySerial service locally on `127.0.0.1:8000`.
3. If Chrome requests Local Network Access / loopback permission, allow it for this site.
4. Frontend polls `http://127.0.0.1:8000/api/status` about every 1.8 seconds.
5. Backend connected + fresh Arduino telemetry → welcome `SYSTEM LIVE` status, with real readings after private login. No backend → demo is available; backend but no Arduino → Arduino offline with simulation available.
6. Operator takes the short pairing code from the backend terminal and unlocks controls. Backend authorizes using a bearer token held in sessionStorage in this tab. Browser permission alone never authorizes actuator commands.
7. Live HTTP POST endpoints go to the loopback backend, which in turn sends framed serial commands to the Uno; polling updates output states and progress.

### Practical limitations

Modern browsers can gate cross-origin access to the loopback address space behind a Local Network Access permission dialog. Browser prompts/permissions cannot be bypassed by the app. Standard cross-origin response headers are restricted to the GitHub Pages origin. Keep the Python service local, with no public port exposure.

### Safety architecture

Controller firmware: physical output shutdown/watchdog and mutual exclusion. Backend: strict input bounds, serialization, acknowledgement handling, pairing token, explicit CORS origin allowlist. Frontend: labels read-only vs paired mode, disables stale controls, never claims physical relay feedback. A physical emergency cutoff is still required.

The public site does not run Python or contain hardware credentials. The six-digit pairing code appears only in the operator's own local backend terminal. Restarting the server rotates credentials.
