# Remote access safety and one-time setup

The public website is `https://nf-niloy.github.io/autolab-scada/`. A local Python bridge must remain running on the Arduino host. GitHub Pages cannot execute the Python API. Tailscale Funnel is an optional HTTPS reverse proxy, not a login provider.

## Host laptop

1. Run `python backend/setup_pin.py` from the project root once; enter the chosen fixed PIN twice. **Do not put this PIN in source code.**
2. Discover your `.ts.net` device DNS name without enabling Funnel.
3. Run `python backend/configure_remote.py https://your-device.your-tailnet.ts.net` (replace the example).
4. Run `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000` from the project root.
5. Verify the Arduino and both outputs are OFF, then run `tailscale funnel --bg 8000` and follow approval prompts.
6. Commit and push the updated frontend source, including `src/remote-config.js`, and verify a second device can see `SYSTEM LIVE` on the welcome page. Do not command any real output until you have supervised the system locally.

## Security and limitations

- `backend/.local/` holds a salted PIN hash and the host-only tunnel address; `.gitignore` excludes it. Do not commit SQLite files.
- PIN-only remote access is weak for public internet control; a stronger factor and physical protective measures are recommended.
- Only a redacted online/offline indicator is public. Telemetry, history and output commands need an authenticated session.
- Five wrong PIN entries globally trigger a one-hour lockout; temporary denial of access is possible.
- Session tokens expire in two hours and after inactivity. A remote-controlled actuator or recipe is stopped by the lease watchdog if the operator browser stops checking in for about 25 seconds. This can abort a recipe if the phone sleeps or loses internet.
- A successful backend STOP acknowledgement is not mechanical proof of shutdown. If STOP fails, serial host heartbeat is suspended to allow firmware timeout; physical cutoff is always required.
- Funnel can be disabled with `tailscale funnel 8000 off`; verify with `tailscale funnel status`.
- This is a supervised educational prototype, not a certified industrial safety or emergency-stop system.
