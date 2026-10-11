# Acceptance checklist (browser demo)

- Open through a static HTTP server, no third-party JS dependencies.
- Overview shows synthetic temperature streams and DEMO banners.
- Manually enable Motor, then attempt Fan ON: conservative interlock prevents concurrent activation.
- STOP disables both channels.
- Open Recipe studio, edit names, durations, ON/OFF states and repeats, save, and reload the page: recipe persists.
- Start recipe: process progresses through steps. Pause disables commanded outputs, resume continues, STOP records an aborted run.
- Run a short recipe to completion: history receives a completed simulated run; analytics show step timings.
- Inject fault during an active run: automatic safe-stop, FAULT state, explicit reset required.
- Export entire JSON; export one run JSON and synthetic CSV.
- Navigation and controls remain usable at 390px mobile viewport.
- Check GitHub Pages subpath; all URLs are relative (no asset absolute root paths).

## Engineering honesty

- `SIMULATED` metadata present in each run and telemetry sample.
- Never call browser scheduler errors “hardware timing accuracy”.
- No actual sensor accuracy, thermal model validation, relay contact feedback or motor health are established here.
- Safety behavior here is a demonstrator, not a safety certification.
