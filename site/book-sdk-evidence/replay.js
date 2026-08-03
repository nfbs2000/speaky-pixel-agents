const shell = document.querySelector('.replay-shell')
const actorGrid = document.getElementById('actor-grid')
const cursorInput = document.getElementById('cursor')
const speedSelect = document.getElementById('speed')
const playButton = document.getElementById('play')

let evidence = null
let cursor = 0
let playing = false
let timer = null
const actorStates = new Map()

try {
  const response = await fetch('./evidence.json', { cache: 'no-store' })
  if (!response.ok) throw new Error(`evidence_http_${response.status}`)
  evidence = await response.json()
  if (evidence.schemaVersion !== 'pixel-book-evidence.v1' || !evidence.events?.length) {
    throw new Error('evidence_contract_invalid')
  }
  initialize()
} catch (error) {
  console.error(error)
  shell.dataset.loadState = 'error'
  document.getElementById('load-error').hidden = false
}

function initialize() {
  shell.dataset.loadState = 'ready'
  document.getElementById('model-badge').textContent = evidence.source.model || 'MODEL NOT RECORDED'
  document.getElementById('proof-badge').textContent = `PROOF · ${evidence.source.proofGate}`
  document.getElementById('stage-boundary').textContent = evidence.boundary
  document.getElementById('raw-count').textContent = evidence.source.sourceEventCount
  document.getElementById('public-count').textContent = evidence.source.publicEventCount
  document.getElementById('observed-count').textContent = evidence.counts.observedClaims
  document.getElementById('pending-count').textContent = evidence.counts.additionalObservationRequired
  cursorInput.max = String(evidence.events.length - 1)

  actorGrid.replaceChildren(...evidence.actors.map(actorElement))
  document.getElementById('claim-list').replaceChildren(...evidence.claims.map(claimElement))
  render(0)

  document.getElementById('restart').addEventListener('click', () => {
    stop()
    actorStates.clear()
    render(0)
  })
  document.getElementById('step').addEventListener('click', () => {
    stop()
    render(Math.min(cursor + 1, evidence.events.length - 1))
  })
  playButton.addEventListener('click', () => playing ? stop() : play())
  cursorInput.addEventListener('input', () => {
    stop()
    rebuildStates(Number(cursorInput.value))
    render(Number(cursorInput.value), false)
  })

  window.__bookSdkEvidenceReplay = {
    getState: () => ({
      schemaVersion: evidence.schemaVersion,
      campaignId: evidence.source.campaignId,
      cursor,
      playing,
      eventCount: evidence.events.length,
      sourceEventCount: evidence.source.sourceEventCount,
      observedClaims: evidence.counts.observedClaims,
      additionalObservationRequired: evidence.counts.additionalObservationRequired,
      activeEvent: evidence.events[cursor],
    }),
    seek: (next) => {
      stop()
      const safe = Math.max(0, Math.min(Number(next) || 0, evidence.events.length - 1))
      rebuildStates(safe)
      render(safe, false)
    },
    play,
    pause: stop,
  }
}

function actorElement(actor) {
  actorStates.set(actor.id, 'idle')
  const article = document.createElement('article')
  article.className = 'actor'
  article.dataset.actor = actor.id
  article.dataset.state = 'idle'
  article.dataset.active = 'false'
  article.innerHTML = `
    <span class="actor__sprite" aria-hidden="true"></span>
    <b>${escapeHtml(actor.label)}</b>
    <small>${escapeHtml(actor.role)}</small>
    <output>IDLE</output>
  `
  return article
}

function claimElement(claim) {
  const item = document.createElement('li')
  item.dataset.status = claim.status
  item.title = claim.sourceRefs.join('\n')
  const label = claim.status === 'observed' ? 'OBSERVED' : 'MORE EVIDENCE'
  item.innerHTML = `
    <header><b>${escapeHtml(claim.id)}</b><em>${label}</em></header>
    <p>${escapeHtml(claim.summary)}</p>
  `
  return item
}

function play() {
  if (cursor >= evidence.events.length - 1) {
    actorStates.clear()
    evidence.actors.forEach((actor) => actorStates.set(actor.id, 'idle'))
    render(0)
  }
  playing = true
  playButton.textContent = 'Ⅱ'
  playButton.setAttribute('aria-label', '일시 정지')
  schedule()
}

function stop() {
  playing = false
  if (timer) window.clearTimeout(timer)
  timer = null
  playButton.textContent = '▶'
  playButton.setAttribute('aria-label', '재생')
}

function schedule() {
  if (!playing) return
  timer = window.setTimeout(() => {
    if (cursor >= evidence.events.length - 1) {
      stop()
      return
    }
    render(cursor + 1)
    schedule()
  }, Number(speedSelect.value))
}

function rebuildStates(target) {
  actorStates.clear()
  evidence.actors.forEach((actor) => actorStates.set(actor.id, 'idle'))
  for (let index = 0; index <= target; index += 1) applyEventState(evidence.events[index])
}

function render(next, applyState = true) {
  cursor = next
  const event = evidence.events[cursor]
  if (applyState) applyEventState(event)

  cursorInput.value = String(cursor)
  document.getElementById('cursor-label').textContent = `${cursor + 1} / ${evidence.events.length}`
  document.getElementById('event-sequence').textContent = `EVENT ${String(cursor + 1).padStart(2, '0')} / ${String(evidence.events.length).padStart(2, '0')}`
  document.getElementById('event-type').textContent = event.eventType
  document.getElementById('event-level').textContent = event.evidenceLevel.toUpperCase()
  document.getElementById('event-summary').textContent = event.summary
  document.getElementById('event-state').textContent = event.pixelState
  document.getElementById('event-actor').textContent = event.actor
  document.getElementById('event-attempt').textContent = event.attemptId || '-'
  document.getElementById('event-source').textContent = event.sourceRefs[0] || '-'

  for (const actor of evidence.actors) {
    const element = actorGrid.querySelector(`[data-actor="${actor.id}"]`)
    const state = actorStates.get(actor.id) || 'idle'
    element.dataset.state = state
    element.dataset.active = String(actor.id === event.actor)
    element.querySelector('output').textContent = state.toUpperCase()
  }
}

function applyEventState(event) {
  if (actorStates.has(event.actor)) actorStates.set(event.actor, event.pixelState)
  if (event.eventType === 'tool.result') actorStates.set('claude', 'ready')
  if (event.eventType === 'assistant.claim') actorStates.set('evaluator', event.pixelState)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
