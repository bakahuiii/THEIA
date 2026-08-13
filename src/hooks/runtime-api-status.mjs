export function createLatestApiStatusLoader({ load, apply }) {
  let latestRequest = 0;

  return async function loadLatestApiStatus() {
    const request = ++latestRequest;
    const status = await load();
    if (request === latestRequest) apply(status);
    return status;
  };
}
