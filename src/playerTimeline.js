function _classify(errOrStatus) {
  if (typeof errOrStatus === 'number') {
    if (errOrStatus === 401 || errOrStatus === 403) return 'auth';
    if (errOrStatus === 404) return 'missing_fields';
    return 'other';
  }
  const code = errOrStatus?.code || errOrStatus?.cause?.code;
  if (code && String(code).startsWith('ECONN')) return 'network';
  return 'other';
}

async function pollPlayerTimeline({ playerUrl, token, sessionKey }) {
  const url = `${playerUrl}/player/timeline/poll?wait=0&commandID=1&type=video&X-Plex-Token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return {
        ok: false,
        failureReason: _classify(res.status),
        endpointStatus: res.status,
      };
    }

    const json = await res.json();
    const timeline = json?.MediaContainer?.Timeline?.[0];
    // Field finding (Android TV LAN stream): direct player timeline often has
    // no usable time payload in our current discovery path. Return explicit
    // missing_fields so callers can keep WS + /sessions fallback behavior.
    if (!timeline || !Number.isFinite(timeline.time)) {
      return { ok: false, failureReason: 'missing_fields', endpointStatus: 200 };
    }

    return {
      ok: true,
      sessionKey: String(sessionKey),
      positionMs: timeline.time,
      state: timeline.state || null,
      endpointStatus: 200,
      raw: timeline,
    };
  } catch (err) {
    return { ok: false, failureReason: _classify(err), endpointStatus: null };
  }
}

module.exports = { pollPlayerTimeline };
