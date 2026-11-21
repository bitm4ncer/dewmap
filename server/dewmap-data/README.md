# dewmap data gateway

Source of the Node service that runs on the VPS as container
`dewmap-data-api` and answers on `https://data.dewmap.app`.

This directory is the **source of truth**; `/opt/dewmap-data/` on the VPS is a
deployment target. Edit here, then copy over (see below).

## Endpoints

| Path | Upstream | Cache |
| --- | --- | --- |
| `GET /health` | – | – |
| `GET /api/status` | – | – |
| `GET /api/weather/radar/frames` | – (computed) | 60 s |
| `GET /api/weather/radar/frames/{YYYYMMDDTHHMM}.png` | DWD GeoServer WMS `Radar_rv_product_1x1km_ger` | immutable, 1 year |
| `GET /api/weather/warnings` | DWD `warnings.json` + DWD WFS `Warngebiete_Kreise,Gemeinden` | 300 s, stale up to 30 min |

There is no generic proxy: the three upstream hosts are hard-coded, the only
variable is a strictly validated radar slot (`now-6h … now+3h`, 5-minute grid).

## Files

- `server.js` — HTTP server, fetch/cache/normalise/warm.
- `lib.js` — pure helpers (slot maths, JSONP parsing, normalisation, join).
- `lib.test.js` — `node --test`, no network.

## Cache

`/app/cache` (bind mount `./cache:/app/cache:rw`):

- `radar/{slot}.png` — immutable frames, pruned after 6 h, hard cap 400 files.
- `warnings/latest.json` — last good payload for restarts and DWD outages.

The service warms the newest radar frame once per 5-minute slot after the first
`/frames` request, so real visitors usually hit a warm cache.

## Deploy

```sh
# backups
cp /opt/dewmap-data/server.js /opt/dewmap-data/server.js.bak-$(date +%Y%m%d-%H%M)
cp /opt/dewmap-data/docker-compose.yml /opt/dewmap-data/docker-compose.yml.bak-$(date +%Y%m%d-%H%M)

# code
scp server/dewmap-data/server.js server/dewmap-data/lib.js bitmancer-server:/opt/dewmap-data/
mkdir -p /opt/dewmap-data/cache/{radar,warnings}

# compose: add ./lib.js:ro and ./cache rw mount, then recreate only this service
docker compose -f /opt/dewmap-data/docker-compose.yml up -d

# verify
curl -fsS https://data.dewmap.app/health
curl -fsS https://data.dewmap.app/api/weather/radar/frames | head -c 200
curl -fsSI https://data.dewmap.app/tiles/transit-lines-v7.pmtiles
```

## Rollback

```sh
cd /opt/dewmap-data
cp server.js.bak-<stamp> server.js
cp docker-compose.yml.bak-<stamp> docker-compose.yml
docker compose -f docker-compose.yml up -d
```

The cache directory can stay; it is ignored by the old server. Remove it with
`rm -rf /opt/dewmap-data/cache` if you want the disk space back.

## Local run

```sh
PORT=8799 DEWMAP_CACHE_DIR=/tmp/dewmap-cache node server/dewmap-data/server.js
```
