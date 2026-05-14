## F1  Qualifying Comparison
This website will let you compare the qualifying times of different teammates. This includes there best time for each race, the average difference between drivers and the overall qualifying score.
## F1 Qualifying Comparison
This website will let you compare the qualifying times of different teammates. This includes their best time for each race, the average difference between drivers and the overall qualifying score.

You can visit the website here:
https://chester117.github.io/F1-Compare-jolpica/

### API Rate Limiting
All data is sourced from https://api.jolpi.ca/ergast/f1/ which enforces rate limiting. The application now includes:

- Data caching to reduce redundant API requests
- Request throttling to avoid hitting rate limits
- Automatic retry logic for failed requests
- Batch processing of historical data
- Aggregated fetching in Race tab to minimize requests per round

### History tab: partial data and retry
- When the upstream API responds with 429 (Too Many Requests), network/CORS errors, or partial sprint listings, the app will:
  - Continue with available data to render a partial table.
  - Display a yellow banner "数据不完整" with a "继续获取" button (also mirrored in a floating bottom-right banner).
  - On click, only the failed URLs are retried via a request queue with adaptive backoff (Retry-After aware). The table refreshes automatically after retry.
- Tips:
  - Prefer a smaller year span (1–3 years) to reduce calls.
  - Sprint data is fetched once per season. If the season sprint list fails to load, the app will skip per-round sprint fallbacks to avoid request storms that trigger 429.
  - You can call `F1Utils.retryFailedRequests()` from the console to manually retry failed items.

When using the history teammate comparison feature, it's recommended to select a smaller date range (1-3 years) to minimize API requests and improve performance.

### Race tab performance and 429 mitigation
- We now use aggregated endpoints to fetch an entire round’s data in one call:
  - Laps (all drivers, single request): `/f1/{year}/{round}/laps.json?limit=2000`
  - Pit stops (all drivers, single request): `/f1/{year}/{round}/pitstops.json?limit=2000` (requested only when the “排除进站圈/出站圈” filter is enabled)
- This reduces calls from 4 per round (per-driver laps + pits) to at most 2 per round, greatly lowering the chance of 429.
- A request queue (500 ms spacing) and 429 backoff are in place; on 429 the UI now skips the affected round gracefully instead of crashing.
- Tips to avoid 429 further:
  - Use a smaller start/end round window.
  - Temporarily uncheck the pit in/out filter to skip pit-stop requests.
  - Use the “清空缓存” button if the upstream data has changed or you want to retry after rate limiting.

### Caching and flushing
- What is cached?
  - Low-level fetch responses (keyed by full URL).
  - History tab helper data (driver codes, driver standings by year, resolved team display names).
  - Race tab per‑driver derived data and per‑round aggregated data (laps/pits for all drivers).

- How long is it valid?
  - Caches are in-memory and only persist for the current page session. They are considered valid until you reload the page or manually clear them. If the upstream API updates (e.g., ongoing season results), you may clear caches to force a fresh fetch.

- How to flush?
  - UI: Click the “清空缓存” button under the top tabs. You’ll see a brief “已清空” confirmation.
  - Console:
    - Flush everything: `F1Utils.flushAllCaches()`
    - Fetch cache only: `F1Utils.flushFetchCache()`
    - History caches only: `window.clearHistoryCaches()`
    - Race caches only: `window.clearRaceCaches()`
    - See cache sizes: `F1Utils.getCacheSummary()`

### Features
- Compare qualifying performance between teammates
- View historical head-to-head statistics
- Analyze qualifying trends over time
- Explore points, race results, and driver standings
- Year comparison tab: pick a single season to see all teams’ teammate pair summary in a sortable table (e.g., sort by median quali gap %, points share, etc.)
 - History tab chart: under the teammate history table, a full-featured multi-year delta% trend graph is rendered, reusing the same chart system as the Qualifying tab (filters, trend lines, export, separate trend view). All qualifying sessions where both drivers set comparable times across the selected years are combined into one sequence.
You can visit the website here:
https://chester117.github.io/F1-Compare-jolpica/


All data is sourced from:
https://api.jolpi.ca/ergast/f1/
