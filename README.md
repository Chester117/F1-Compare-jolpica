# F1 Qualifying Comparison

Compare Formula 1 teammates across qualifying pace, official qualifying position, race pace, points, standings, and multi-year history.

Website:
https://chester117.github.io/F1-Compare-jolpica/

Data source:
https://api.jolpi.ca/ergast/f1/

## Features

- Compare qualifying performance between teammates.
- Track pure pace and official qualifying position head-to-head scores, including ties.
- View historical teammate statistics across one or more seasons.
- Analyze qualifying trends with filtering, trend lines, and chart export.
- Compare race median lap pace with optional pit in/out lap filtering.
- Explore points, race results, driver standings, and a single-year all-team comparison table.

## API Rate Limiting

Jolpica enforces rate limits. The app mitigates that with:

- Request throttling through a shared queue.
- Retry/backoff handling for 429 responses, including `Retry-After` when available.
- In-flight request de-duplication so identical concurrent requests share one fetch.
- In-memory fetch caching with a 30-minute TTL.
- Persistent `localStorage` fetch caching for cacheable responses under a size cap.
- Batch-style history processing and resume controls for partial results.

## History Tab: Partial Data and Retry

When the upstream API responds with 429, network/CORS errors, or partial sprint listings, the app will:

- Continue with available data to render a partial table.
- Display a yellow "数据不完整" banner with a "继续获取" button.
- Retry only failed URLs through the request queue when the user continues.

Tips:

- Prefer a smaller year span, such as 1-3 years, when exploring large history ranges.
- Sprint data is fetched once per season. If the season sprint list fails, the app skips per-round sprint fallbacks to avoid request storms.
- You can call `F1Utils.retryFailedRequests()` from the browser console to manually retry failed items.

## Race Tab Performance

The race comparison tab intentionally uses per-driver endpoints:

- Laps: `/f1/{year}/{round}/drivers/{driverId}/laps.json?limit=100`
- Pit stops: `/f1/{year}/{round}/drivers/{driverId}/pitstops.json?limit=100`

Jolpica's round-level laps endpoint can truncate timing data because one race contains many more timing entries than a single page can reliably return. Per-driver lap requests fit a full race within the API limit and avoid missing most of the field after the first few laps.

Pit stop data is loaded only when the "排除进站圈/出站圈" filter is enabled. If lap data was already cached without pit data, the cache is upgraded on demand when pit filtering is later enabled.

## Caching and Flushing

Cached data includes:

- Low-level fetch responses keyed by full URL.
- Persistent low-level fetch responses in `localStorage` for responses below the size cap.
- History helper data, including driver codes, standings by year, and resolved team display names.
- Race tab derived data, including per-driver laps and optional pit/out lap sets.

Default fetch cache TTL is 30 minutes. Memory cache is page-session scoped; persistent fetch cache survives reloads until TTL expiry or manual clearing.

Flush options:

- UI: click the "清空缓存" button under the top tabs.
- Console:
  - `F1Utils.flushAllCaches()`
  - `F1Utils.flushFetchCache()`
  - `window.clearHistoryCaches()`
  - `window.clearRaceCaches()`
  - `F1Utils.getCacheSummary()`
