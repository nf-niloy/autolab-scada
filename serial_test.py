
import serial
import time
import sys

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM5"
BAUD = 115200

with serial.Serial(PORT, BAUD, timeout=0.2) as arduino:
    time.sleep(2)  # Arduino may reboot on serial connection

    print(f"Connected to Arduino on {PORT}")
    print("Press Ctrl+C to stop.\n")

    last_ping = 0
    command_id = 1

    try:
        while True:
            now = time.monotonic()

            # Keep Arduino watchdog alive
            if now - last_ping >= 2:
                cmd = f"CMD,{command_id},PING\n"
                arduino.write(cmd.encode())

                command_id += 1
                last_ping = now

            # Receive Arduino telemetry
            line = arduino.readline().decode(
                "utf-8", errors="replace"
            ).strip()

            if line:
                print(line)

    except KeyboardInterrupt:
        # Request safe shutdown
        arduino.write(b"CMD,999,STOP\n")
        arduino.flush()
        print("\nSTOP command sent.")
