# SafeSchool Load Testing (k6)

Performance and load testing scripts for the SafeSchool OS API using [k6](https://k6.io/).

## Installation

**macOS:**
```bash
brew install k6
```

**Windows:**
```bash
choco install k6
```

**Docker:**
```bash
docker run --rm -i grafana/k6 run - <script.js
```

**Linux (Debian/Ubuntu):**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

## Prerequisites

1. The SafeSchool API must be running (locally or remotely).
2. The database must be seeded with test data (`npm run db:seed` in the API package).
3. The seeded admin user (admin@lincoln.edu) must exist.

## Environment Variables

| Variable        | Default                    | Description                        |
|-----------------|----------------------------|------------------------------------|
| `API_URL`       | `http://localhost:3000`    | Base URL of the SafeSchool API     |
| `TEST_EMAIL`    | `admin@lincoln.edu`   | Email for authentication           |
| `TEST_PASSWORD` | `safeschool123`            | Password for authentication        |
| `SITE_ID`       | `00000000-0000-4000-a000-000000000001` | Site ID for subscription tests |

## Running Tests

### Baseline (normal load)
```bash
k6 run test/load/baseline.js
```

### Stress test (ramp to 100 VUs)
```bash
k6 run test/load/stress.js
```

### Spike test (sudden emergency surge)
```bash
k6 run test/load/spike.js
```

### WebSocket test (concurrent connections)
```bash
k6 run test/load/websocket.js
```

### With custom API URL
```bash
k6 run -e API_URL=https://api-production-5f06.up.railway.app test/load/baseline.js
```

### With Docker
```bash
docker run --rm -i --network host \
  -e API_URL=http://localhost:3000 \
  grafana/k6 run - < test/load/baseline.js
```

## Test Scenarios

| Script         | VUs     | Duration | Purpose                                    |
|----------------|---------|----------|--------------------------------------------|
| `baseline.js`  | 10      | 2 min    | Normal operational load                    |
| `stress.js`    | 10-100  | 5 min    | Gradual ramp to find breaking point        |
| `spike.js`     | 5-50    | 2 min    | Sudden surge simulating emergency event    |
| `websocket.js` | 20      | 2 min    | Concurrent WebSocket connections + latency |

## Thresholds

Each test defines pass/fail thresholds. k6 will exit with a non-zero code if any threshold is breached:

- **baseline**: p(95) < 500ms, error rate < 1%
- **stress**: p(95) < 1000ms, error rate < 5%
- **spike**: p(95) < 2000ms, error rate < 10%
- **websocket**: p(95) < 300ms for WS messages

## Output Formats

Export results to JSON or InfluxDB for dashboarding:

```bash
# JSON output
k6 run --out json=results.json test/load/baseline.js

# CSV output
k6 run --out csv=results.csv test/load/baseline.js
```
