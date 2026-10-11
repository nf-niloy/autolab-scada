# AutoLab SCADA live control

The frontend runs in any browser as a GitHub Pages static application. Live data is supplied by a backend on the Arduino-connected laptop. Locally it uses `http://127.0.0.1:8000`; optional Tailscale Funnel permits a remote HTTPS URL configured in `src/remote-config.js`.

**Authentication:** run `python backend/setup_pin.py` once, storing a salted password hash in ignored `backend/.local/`. The browser uses the fixed PIN only for login, then receives a short-lived random bearer token stored in that tab's sessionStorage. The PIN is not printed or served by GitHub Pages. Visit `docs/REMOTE_ACCESS.md` for deployment steps.

**Safety:** firmware enforces output interlock and serial timeout; backend validates recipes and commands, denies unauthenticated operations, and stops active controls on browser heartbeat timeout. Browser STOP and software safeguards are not certified safety devices. Keep the Arduino and loads physically supervised, and provide a physical power disconnect.
