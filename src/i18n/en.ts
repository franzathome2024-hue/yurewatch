import type { MessageKey } from './ja';

/**
 * English message catalog.
 *
 * Typed as `Record<MessageKey, string>`, so a missing or misspelled key is a
 * compile error rather than a silent fallback to Japanese.
 *
 * Translation policy:
 *  - Never soften or strengthen an official message. 警報 → "Warning",
 *    予報 → "Forecast", 取消 → "Cancelled".
 *  - Seismic intensity keeps JMA's scale names ("5 lower", "5 upper"), which is
 *    how JMA renders 震度5弱 / 震度5強 in English.
 *  - Proper nouns supplied by the source (epicenter and area names) stay in
 *    Japanese: they are data, not UI copy, and translating them would invent
 *    information that the source did not provide.
 */
export const en: Record<MessageKey, string> = {
  /* ---------------- shell ---------------- */
  'app.title': 'YureWatch — Japan earthquake & EEW viewer',
  'app.brandSub': 'Japan earthquake & EEW viewer',
  'app.description':
    'Viewer for Japanese earthquake information, Earthquake Early Warnings (EEW) and tsunami information on a map. It does not predict earthquakes or detect them independently.',
  'app.disclaimer':
    'This is an information viewer. It does not predict or independently detect earthquakes. Always follow JMA announcements and local authority instructions.',
  'app.audio.on': 'Sound: ON',
  'app.audio.off': 'Sound: OFF',
  'app.audio.aria': 'Toggle alert sound',

  'tab.feed': 'Quakes',
  'tab.detail': 'Details',
  'tab.info': 'Info',
  'tab.aria': 'Switch view',

  'lang.label': 'Language',
  'lang.ja': '日本語',
  'lang.en': 'English',
  'lang.aria': 'Switch to {name}',

  /* ---------------- header ---------------- */
  'mode.live': 'LIVE',
  'mode.demo': 'DEMO',
  'mode.aria.live': 'Live mode (public data)',
  'mode.aria.demo': 'Demo mode (simulated data)',
  'mode.connPrefix.demo': 'Demo · ',

  'conn.live': 'Live',
  'conn.degraded': 'Unstable',
  'conn.stale': 'Updates stopped',
  'conn.offline': 'Offline',
  'conn.connecting': 'Connecting',
  'conn.demo': 'Demo mode',
  'conn.none': 'Not connected',
  'conn.aria': 'Connection status: {state}',

  'fresh.fresh': 'Up to date',
  'fresh.aging': 'Slightly delayed',
  'fresh.stale': 'Stale data',
  'fresh.nodata': 'No data',
  'fresh.unknown': 'Time unknown',

  /* ---------------- shared values ---------------- */
  'meta.unknown': 'Unknown',
  'meta.emDash': '—',
  'meta.jst': 'JST',
  'meta.now': 'just now',
  'age.seconds': '{n}s ago',
  'age.minutes': '{n}m ago',
  'age.hours': '{n}h ago',
  'age.days': '{n}d ago',
  'age.unknownTime': 'Time unknown',
  'age.received': 'received {age}',

  /* ---------------- EEW panel ---------------- */
  'alert.kicker': 'Earthquake Early Warning',
  'alert.badge.waiting': 'Standing by',
  'alert.badge.unknown': 'Status unknown',
  'alert.idle.onlineMain': 'No Earthquake Early Warning is currently in effect (within received data).',
  'alert.idle.onlineNote':
    'Data refreshes every few tens of seconds. Warnings can arrive after shaking starts, so do not rely on this screen alone.',
  'alert.idle.offlineMain': 'Disconnected, so the warning status cannot be confirmed.',
  'alert.idle.offlineNote':
    'The app retries automatically when the network returns. This display does not prove that no warning was issued.',
  'alert.idle.lastReceived': 'Last received: {time} ({age})',

  'alert.state.forecast': 'EEW (Forecast)',
  'alert.state.warning': 'EEW (Warning)',
  'alert.state.updated': 'EEW (Update)',
  'alert.state.cancelled': 'EEW (Cancelled)',
  'alert.state.unavailable': 'EEW (Status unknown)',
  'alert.state.idle': 'No EEW',

  'alert.serial': 'Report #{n}',
  'alert.badge.test': 'TEST',
  'alert.cancelledTitle': 'The issued Earthquake Early Warning was cancelled',
  'alert.cancelledNote':
    'A cancellation does not mean there was no shaking. Check the actual observed intensity information.',
  'alert.scaleLabel': 'Estimated max intensity',
  'alert.fact.epicenter': 'Epicenter',
  'alert.fact.magnitude': 'Magnitude',
  'alert.fact.depth': 'Depth',
  'alert.fact.intensity': 'Est. intensity',
  'alert.value.noInfo': 'Not reported',
  'alert.epicenterUnknown': 'Epicenter unknown',
  'alert.time.origin': 'Origin',
  'alert.time.issued': 'Issued',
  'alert.provisional': 'The hypocenter is a provisional (assumed) element. It may change substantially in later reports.',
  'alert.arrival.soonest': 'Earliest S-wave arrival estimate',
  'alert.arrival.past': 'S-wave arrival estimate (passed)',
  'alert.arrival.source': '{area} (JMA estimate)',
  'alert.arrival.disclaimer': 'Not the arrival time at your location',
  'alert.arrival.noneTitle': 'S-wave arrival estimate',
  'alert.arrival.noneBody': 'This message does not include an estimated arrival time',
  'alert.areas.title': 'Warning areas ({n})',
  'alert.areas.order': 'Highest estimated intensity first',
  'alert.areas.more': '{n} more areas',
  'alert.areas.missing': 'This message includes no warning areas. Do not treat it as a warning.',
  'alert.sim': 'SIMULATION: this alert is demo data generated inside the app. It is not real earthquake information.',
  'alert.disclaimer':
    'Estimates carry error and may change in later reports. Always confirm JMA announcements and instructions from your local authority.',

  'kind.mainNotArrived': 'S-wave not arrived',
  'kind.mainArrived': 'S-wave arrived',
  'kind.plum': 'PLUM method',

  /* ---------------- feed ---------------- */
  'feed.title': 'Earthquakes',
  'feed.count': '{n}',
  'feed.empty.offline': 'Earthquake information unavailable (offline)',
  'feed.empty.online': 'No earthquake information yet',
  'feed.empty.note': 'New reports are added to this list automatically.',
  'feed.badge.preliminary': 'Prelim.',
  'feed.badge.sim': 'SIM',
  'feed.headScale': 'Intensity',
  'feed.meta.depth': 'Depth {depth}',
  'feed.name.unknown': 'Epicenter unknown',
  'feed.aria.select': 'Show details for {name} at {time}',

  /* ---------------- details ---------------- */
  'details.title': 'Earthquake details',
  'details.close': 'Close details',
  'details.empty': 'Select an earthquake on the map or in the list.',
  'details.emptyHint': 'Shows the epicenter, magnitude and observed intensities.',
  'details.scaleLabel': 'Max intensity',
  'details.badge.preliminary': 'Preliminary',
  'details.badge.detailed': 'Detailed',
  'details.approx': 'around {time}',
  'details.kv.magnitude': 'Magnitude',
  'details.kv.depth': 'Depth',
  'details.kv.epicenter': 'Epicenter',
  'details.kv.issued': 'Issued',
  'details.kv.received': 'Received',
  'details.provisional': 'The hypocenter is a provisional (assumed) element, not a final value.',
  'details.points.title': 'Observed intensity by location',
  'details.points.count': '{n} stations',
  'details.points.more': '{n} more stations (highest shown only)',
  'details.points.pending': 'Observed intensities have not been issued yet.',
  'details.source': 'Source: {provider}',
  'details.sourceRelayed': ' (relaying JMA information)',
  'details.sourceMerged': ' · {n} messages merged',
  'details.notApplicable': '—',

  'infoType.scalePrompt': 'Intensity prompt',
  'infoType.destination': 'Epicenter information',
  'infoType.scaleAndDestination': 'Intensity & epicenter information',
  'infoType.detailScale': 'Intensity at each location',
  'infoType.foreign': 'Distant earthquake information',
  'infoType.other': 'Other information',
  'infoType.default': 'Earthquake information',
  'details.depthShallow': 'very shallow',

  /* ---------------- tsunami ---------------- */
  'tsunami.none': 'No tsunami concern from this earthquake (JMA)',
  'tsunami.nonEffective': 'Slight sea-level changes possible, but no threat of damage',
  'tsunami.watch': 'A tsunami advisory is in effect',
  'tsunami.warning': 'A tsunami warning is in effect',
  'tsunami.majorWarning': 'A major tsunami warning is in effect',
  'tsunami.checking': 'Checking whether a tsunami was generated',
  'tsunami.unknown': 'No tsunami information received',
  'tsunami.sectionTitle': 'Tsunami information',
  'tsunami.sectionSubtitle': 'Warnings, advisories, forecasts',
  'tsunami.notReceived': 'No tsunami forecast received. Also check the “tsunami concern” line in each earthquake report.',
  'tsunami.cancelled': 'The tsunami forecast has been lifted.',
  'tsunami.noAreas': 'The tsunami forecast contains no area information.',
  'tsunami.issued': 'Issued: {time} ({provider})',
  'tsunami.areas': '{n} areas',
  'tsunami.receivedNone': 'None received',
  'tsunami.present': 'In effect · {sub}',

  'grade.majorWarning': 'Major tsunami warning',
  'grade.warning': 'Tsunami warning',
  'grade.watch': 'Tsunami advisory',
  'grade.nonEffective': 'Slight sea-level change',
  'grade.default': 'Tsunami forecast',

  /* ---------------- NIED ---------------- */
  'nied.sectionTitle': 'NIED real-time intensity',
  'nied.subtitle': 'Not connected',
  'nied.body1': 'Not implemented in this version. Nothing here is filled in with guesses or substitute data.',
  'nied.body2':
    'NIED’s real-time seismic intensity monitoring (long-period ground motion monitor) exposes no documented machine-readable API, so this version does not connect to it. It will be implemented only after the terms of use are confirmed and the data provider has agreed.',
  'nied.body3':
    'Current substitute: JMA “intensity at each location” from earthquake reports. Those are observations, and they are computed differently from NIED’s measured intensity.',

  /* ---------------- diagnostics ---------------- */
  'diag.sectionTitle': 'Connection & data freshness',
  'diag.subtitle': 'Source, timestamps, errors',
  'diag.classification': 'Report type',
  'diag.mode': 'Mode',
  'diag.mode.live': 'LIVE (public data)',
  'diag.mode.demo': 'DEMO (simulated data)',
  'diag.conn': 'Connection',
  'diag.lastOk': 'Last success',
  'diag.freshness': 'Freshness',
  'diag.batches': 'Received batches',
  'diag.rejected': 'Rejected records',
  'diag.dupes': 'Duplicate / out-of-order alerts',
  'diag.lastError': 'Last error',
  'diag.provider': 'Data provider',
  'diag.provider.live': 'P2P Earthquake Information JSON API v2 (relaying JMA information)',
  'diag.provider.demo': 'YureWatch DEMO ENGINE',
  'diag.polling':
    'Poll interval: 20 s idle / 6 s while an alert is active. Each refresh uses 3 requests against the published limit of 60 req/min.',
  'diag.subtitleValue': '{conn} · {fresh}',

  /* ---------------- about ---------------- */
  'about.sectionTitle': 'About this app / caveats',
  'about.subtitle': 'Limits of the information',
  'about.p1':
    'YureWatch is an information viewer. It does not predict earthquakes or detect them independently, and it cannot guarantee that a warning arrives before shaking.',
  'about.li1': 'EEW estimates contain error and change in later reports (including false alerts and missed events).',
  'about.li2': '“Forecast” and “Warning” are different things. This app keeps them visually distinct.',
  'about.li3': 'Estimated intensity is sometimes not issued, for example for hypocenters deeper than 150 km.',
  'about.li4': 'Network delay or loss can prevent information from arriving at all.',
  'about.li5': 'For any decision, follow JMA announcements and instructions from your local authority.',
  'about.attribution':
    'Map: Natural Earth (public domain). Data: P2P Earthquake Information JSON API v2 (relaying JMA information).',

  /* ---------------- demo ---------------- */
  'demo.title': 'Demo / test',
  'demo.subtitle': 'Play simulated data (SIMULATION)',
  'demo.status': '{label} — {state}',
  'demo.running': 'Playing',
  'demo.finished': 'Finished',
  'demo.note': 'Everything started here is simulated inside the app. It is not real earthquake information.',
  'demo.stop': 'Stop demo and go live',
  'demo.export': 'Export state as JSON',
  'demo.simBadge': 'SIMULATION',

  'scenario.normal.label': 'Normal',
  'scenario.normal.summary': 'No EEW. Only recent earthquake reports, with history markers on the map.',
  'scenario.forecast.label': 'EEW forecast',
  'scenario.forecast.summary': 'First EEW forecast report, while warning areas are not finalised yet.',
  'scenario.warning.label': 'EEW warning',
  'scenario.warning.summary': 'First EEW warning report, with estimated max intensity and warning areas.',
  'scenario.updated.label': 'EEW updates',
  'scenario.updated.summary': 'Report #1 → #2 → #3, showing estimates being revised.',
  'scenario.cancelled.label': 'EEW cancelled',
  'scenario.cancelled.summary': 'A cancellation arrives after a warning. A cancellation does not mean there was no shaking.',
  'scenario.historical.label': 'History (several quakes)',
  'scenario.historical.summary': 'A history including an intensity prompt updated to a detailed report; preliminary stages are labelled.',
  'scenario.disconnect.label': 'Disconnect → recovery',
  'scenario.disconnect.summary': 'Detects a dropped connection, states “offline”, then refetches after recovery.',
  'scenario.stale.label': 'Stale data',
  'scenario.stale.summary': 'Data stops updating. The app says it is stale instead of showing it as live.',
  'scenario.unavailable.label': 'Missing data',
  'scenario.unavailable.summary': 'Broken records and empty responses are mixed in to confirm bad data is dropped and the display survives.',

  /* ---------------- map ---------------- */
  'map.aria': 'Map of Japan. Drag to pan, pinch or scroll to zoom.',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.recenter': 'Show all of Japan',
  'map.eewPredicted': 'Est. max intensity {scale}',
  'map.attribution': 'Map data: Natural Earth (public domain)',
  'map.legendEew': 'EEW epicenter (estimated)',
  'map.scaleBar': '{km} km',
  'map.canvasUnsupported': 'This device cannot render the map (Canvas 2D unsupported)',
  'map.error': 'Map failed to initialise: {message}',
  'map.errorSuffix': 'The list views remain usable.',

  /* ---------------- simulation banner / boot ---------------- */
  'sim.banner': 'Everything shown here is simulated data. It is not real earthquake information.',
  'boot.loading': 'Loading…',
  'boot.slowTitle': 'Startup is taking longer than expected',
  'boot.slowBody':
    'The app bundle may have failed to load. Open the prebuilt single-file build (dist/yurewatch.html) or restart the app.',
  'boot.fatal': 'Could not start: {message} Restart the app.',
  'boot.noscript': 'YureWatch requires JavaScript. Enable it in your browser settings.',

  /* ---------------- v0.2 shell ---------------- */
  'app.context': 'Japan earthquake monitoring',
  'nav.label': 'Switch view',
  'nav.map': 'Map',
  'nav.list': 'Earthquakes',
  'nav.detail': 'Details',
  'nav.info': 'Info',

  'status.source': 'P2P Earthquake Information v2 (relaying JMA)',
  'status.lastUpdate': 'Last update {time}',
  'status.mode.live': 'LIVE',
  'status.mode.demo': 'DEMO',
  'status.retry': 'Retry',
  'status.noData': 'Data unavailable',
  'status.receivedAt': 'received {time}',

  'alert.strip.label': 'EEW',
  'alert.strip.none': 'None received',
  'alert.strip.unknown': 'Status unknown (not connected)',
  'alert.strip.checked': 'Last checked {time}',
  'alert.strip.offline': 'Disconnected — cannot confirm warning status',
  'alert.hatched': 'Hypocenter not estimated, so no arrival estimate is shown',

  'map.legend': 'Legend',
  'map.legendTitle': 'Map key',
  'map.legendIntensity': 'Intensity (marker colour and number)',
  'map.legendEewMarker': 'EEW epicenter (estimated, issued before shaking)',
  'map.legendQuakeMarker': 'Earthquake epicenter (issued after observation)',
  'map.legendSelected': 'Selected earthquake',
  'map.legendUnavailable': 'Intensity distribution overlay is not provided',
  'map.controlsLabel': 'Map controls',

  'sheet.label': 'Earthquake information panel',
  'sheet.hintCollapse': 'Tap to enlarge the map',
  'sheet.peekHint': 'Tap to open earthquake information',
  'sheet.peekEmpty': 'No earthquake information yet',
  'sheet.expand': 'Expand panel',
  'sheet.collapse': 'Collapse panel',
  'sheet.peekSummary': '{name} {magnitude} · {time}',

  'list.title': 'Recent earthquakes',
  'list.originLabel': 'Origin',
  'list.reportedLabel': 'Issued',

  'set.title': 'Settings',
  'set.sectionDisplay': 'Display',
  'set.language': 'Language',
  'set.languageHelp': 'Japanese is the default. Your choice is saved.',
  'set.sound': 'Alert sound',
  'set.soundOn': 'ON',
  'set.soundOff': 'OFF',
  'set.soundHelp': 'Sounds only when a warning arrives. Silent for demos unless enabled.',
  'set.sectionSource': 'Data',
  'set.sourceHelp': 'Live data comes from the P2P Earthquake Information JSON API v2 (relaying JMA information).',
  'set.sectionDev': 'Developer',
  'set.demo': 'Demo / simulated data',
  'set.sectionAbout': 'About this app',
  'set.version': 'Version {version}',
  'set.attribution': 'Map data: Natural Earth (public domain)',
};
