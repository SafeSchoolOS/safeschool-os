# SafeSchool Deploy

Campus safety and school security platform.

## Gateway (NanoPi / Linux)

EdgeRuntime only — syncs visitor, lockdown, bus, and incident data to cloud.

```bash
cd gateway
cp .env.example .env   # fill in ACTIVATION_KEY, SITE_ID
docker compose up -d
```

## Windows Gateway

Same as gateway, optimized for Windows Docker Desktop.

```bash
cd windows
cp .env.example .env   # fill in ACTIVATION_KEY, SITE_ID
docker compose up -d
```

## Appliance (Full Stack)

EdgeRuntime + SafeSchool API + Dashboard + Kiosk + Admin + Postgres + Redis + Caddy.

```bash
cd appliance
cp .env.example .env   # fill in all variables
docker compose up -d
```

Access points:
- Dashboard: https://localhost (port 443)
- Kiosk: https://localhost:8443
- API: https://localhost:3443
- Admin: http://localhost:9091
