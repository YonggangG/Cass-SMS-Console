# Cass SMS Console

Cass SMS Console is a lightweight LAN web console for [Cass SMS Gateway](https://github.com/YonggangG/cass-sms-gateway). It runs on a computer, NAS, or mini server in the same local network as the Android phone, connects to the phone gateway, and provides a browser UI for sending, receiving, viewing, and backing up SMS records.

> Chinese documentation: [README.zh-CN.md](README.zh-CN.md)

## Screenshots

### Android Gateway setup screen

![Cass SMS Gateway Android setup screen](docs/images/cass-sms-gateway-android.jpg)

### Desktop web console

![Cass SMS Console desktop web UI](docs/images/cass-sms-console-screenshot.jpg)

### Mobile web console

![Cass SMS Console mobile web UI](docs/images/cass-sms-console-mobile.jpg)

## Features

- Show whether the phone-side Cass SMS Gateway is online or offline
- Read and select active SIM/eSIM subscriptions from the phone
- Send SMS from a LAN web page
- View received and sent SMS records cached by the phone gateway
- Automatically sync records and append new entries to a local CSV file
- Runs as a simple Node.js service or Docker container
- Portainer-friendly stack file included

## How It Works

```text
Browser / Portainer host
        |
        v
Cass SMS Console :3000
        |
        v
Android phone running Cass SMS Gateway :8080
```

The phone still sends and receives SMS. This console is only the LAN-side web UI and local CSV backup service.

## Release Notes

- v0.1.1: Keep the selected SIM/eSIM fixed across automatic 3-second status refreshes.

## Docker Image

Image tag:

```text
ghcr.io/yonggangg/cass-sms-console:latest
```

The GHCR image can be pulled directly. The v0.1.1 GitHub Release also includes a prebuilt Docker image archive for offline installation.

```bash
curl -L -o cass-sms-console-v0.1.1-docker-image.tar.gz \
  https://github.com/YonggangG/Cass-SMS-Console/releases/download/v0.1.1/cass-sms-console-v0.1.1-docker-image.tar.gz
gzip -dc cass-sms-console-v0.1.1-docker-image.tar.gz | docker load
```

## Quick Start with Portainer

1. Install and start Cass SMS Gateway on the Android phone.
2. Grant SMS / SIM / notification permissions.
3. Start the LAN service on the phone.
4. Copy the phone URL shown by the app, for example:

```text
http://192.168.1.23:8080/?token=abc123
```

Split it into:

- `CASS_PHONE_BASE_URL`: `http://192.168.1.23:8080`
- `CASS_TOKEN`: `abc123`

5. In Portainer, create a new Stack and paste:

```yaml
services:
  cass-sms-console:
    image: ghcr.io/yonggangg/cass-sms-console:latest
    container_name: cass-sms-console
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      CASS_PHONE_BASE_URL: "http://192.168.1.23:8080"
      CASS_TOKEN: "PASTE_PHONE_TOKEN_HERE"
      CASS_SYNC_INTERVAL_MS: "3000"
      CASS_CSV_PATH: "/data/sms-records.csv"
    volumes:
      - cass-sms-data:/data

volumes:
  cass-sms-data:
```

6. Deploy the stack, then open:

```text
http://DOCKER_HOST_LAN_IP:3000
```

The CSV backup is stored inside the Docker volume `cass-sms-data` at:

```text
/data/sms-records.csv
```

## Docker CLI

```bash
docker run -d \
  --name cass-sms-console \
  --restart unless-stopped \
  -p 3000:3000 \
  -e CASS_PHONE_BASE_URL="http://192.168.1.23:8080" \
  -e CASS_TOKEN="abc123" \
  -e CASS_SYNC_INTERVAL_MS="3000" \
  -v cass-sms-data:/data \
  ghcr.io/yonggangg/cass-sms-console:latest
```

## Local Node.js Run

Requires Node.js 18 or newer.

```bash
git clone https://github.com/YonggangG/Cass-SMS-Console.git
cd Cass-SMS-Console
cp config.example.json config.json
```

Edit `config.json`:

```json
{
  "phoneBaseUrl": "http://192.168.1.23:8080",
  "token": "abc123",
  "host": "0.0.0.0",
  "port": 3000,
  "syncIntervalMs": 3000,
  "csvPath": "./data/sms-records.csv"
}
```

Start:

```bash
node server.js
```

Open:

```text
http://localhost:3000
```

## Environment Variables

Environment variables override `config.json`.

| Variable | Description | Default |
| --- | --- | --- |
| `CASS_PHONE_BASE_URL` | Phone gateway base URL without token | `http://192.168.1.23:8080` |
| `CASS_TOKEN` | Phone gateway access token | empty |
| `CASS_HOST` | Bind host | `0.0.0.0` |
| `CASS_PORT` | Console port | `3000` |
| `CASS_SYNC_INTERVAL_MS` | Sync interval in milliseconds | `3000` |
| `CASS_CSV_PATH` | CSV backup path | `/data/sms-records.csv` in Docker |

## CSV Backup Format

```csv
id,timestamp_iso,timestamp_ms,direction,phone,text,subscriptionId,status
```

The service periodically pulls `/api/messages` from the phone gateway. New records are appended to the CSV file.

## Build Image Locally

```bash
docker build -t ghcr.io/yonggangg/cass-sms-console:latest .
```

## Security Notes

- Use only on a trusted LAN.
- Do not expose the phone gateway port `8080` or console port `3000` to the public Internet.
- Keep `CASS_TOKEN` private.
- The CSV file contains SMS content. Protect the host and Docker volume accordingly.

## License

Private/local-use friendly MVP. Add a formal license before broader public distribution if needed.
