#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const verifyPath = valueAfter('--verify')

if (verifyPath) {
  await verifyProjection(path.resolve(verifyPath))
  process.exit(0)
}

const tracePath = path.resolve(requiredValue('--trace'))
const summaryPath = path.resolve(requiredValue('--summary'))
const outputPath = path.resolve(requiredValue('--out'))
const catalogPath = valueAfter('--catalog') ? path.resolve(valueAfter('--catalog')) : null
const traceText = await fs.readFile(tracePath, 'utf8')
const summaryText = await fs.readFile(summaryPath, 'utf8')
const trace = JSON.parse(traceText)
const summary = JSON.parse(summaryText)

if (trace.chapterSlug !== summary.chapter_id) {
  throw new Error(`pixel_book_evidence_chapter_mismatch: ${trace.chapterSlug} != ${summary.chapter_id}`)
}

if (!Array.isArray(trace.events) || trace.events.length === 0) {
  throw new Error('pixel_book_evidence_trace_has_no_events')
}

const claims = trace.events
  .filter((event) => event.eventType === 'assistant.claim')
  .map((event) => ({
    id: stringValue(event?.attributes?.claimId, event.id),
    status: stringValue(event?.attributes?.status, 'unknown'),
    evidenceLevel: stringValue(event.evidenceLevel, 'Missing'),
    summary: safeText(event.summary),
    sourceRefs: safeRefs(event.sourceRefs),
  }))

const traceClaimStatuses = claims.map((claim) => claim.status)
if (JSON.stringify(traceClaimStatuses) !== JSON.stringify(summary.claim_statuses)) {
  throw new Error('pixel_book_evidence_claim_status_mismatch')
}

const events = trace.events.map((event, sequence) => ({
  id: stringValue(event.id, `event-${sequence}`),
  sequence,
  timestampOffsetMs: finiteNumber(event.timestampOffsetMs, sequence * 500),
  actor: stringValue(event.actor, 'runtime'),
  eventType: stringValue(event.eventType, 'unknown'),
  pixelState: pixelState(event),
  evidenceLevel: stringValue(event.evidenceLevel, 'Missing'),
  summary: safeText(event.summary),
  sourceRefs: safeRefs(event.sourceRefs),
  attemptId: optionalString(event?.attributes?.attemptId),
  caseId: optionalString(event?.attributes?.caseId),
  toolName: optionalString(event?.attributes?.toolName),
  toolUseId: optionalString(event?.attributes?.toolUseId),
  outcome: optionalString(event?.attributes?.outcome),
  claimStatus: optionalString(event?.attributes?.status),
}))

const projection = {
  schemaVersion: 'pixel-book-evidence.v1',
  generatedAt: new Date().toISOString(),
  title: trace.title,
  description: 'Education Shell의 검증된 Book SDK 실행을 Pixel Agents 상태 문법으로 재생한 공개 projection',
  boundary: 'Pixel Agents 제품이 이 실행을 수집했다는 뜻이 아니며, renderer는 source 판정을 변경하지 않는다.',
  source: {
    courseId: trace.courseId,
    chapterSlug: trace.chapterSlug,
    campaignId: stringValue(summary.campaign_id, trace?.recordedRun?.sourceRunId),
    traceId: trace.traceId,
    traceSha256: sha256(traceText),
    summarySha256: sha256(summaryText),
    sourceEventCount: finiteNumber(summary.source_event_count, trace.events.length),
    publicEventCount: trace.events.length,
    model: Array.isArray(summary.actual_models) ? summary.actual_models[0] : undefined,
    attemptIds: Array.isArray(summary.source_attempts)
      ? summary.source_attempts.map((attempt) => attempt.attempt_id).filter(Boolean)
      : [],
    proofGate: summary.proof_gate,
    secretScan: summary.secret_scan,
  },
  actors: [
    { id: 'user', label: '검증 프롬프트', role: 'briefing', station: 0 },
    { id: 'runtime', label: 'Python SDK 런타임', role: 'control', station: 1 },
    { id: 'claude', label: 'Claude Opus 5', role: 'model', station: 2 },
    { id: 'tool', label: 'SDK 도구 실행', role: 'execution', station: 3 },
    { id: 'evaluator', label: '증거 판정기', role: 'verification', station: 4 },
  ],
  counts: {
    observedClaims: claims.filter((claim) => claim.status === 'observed').length,
    additionalObservationRequired: claims.filter(
      (claim) => claim.status === 'additional_observation_required',
    ).length,
    invalidAttempts: Array.isArray(summary.invalid_attempts) ? summary.invalid_attempts.length : 0,
  },
  claims,
  events,
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(projection, null, 2)}\n`)
await verifyProjection(outputPath)
if (catalogPath) await updateCatalog(catalogPath, outputPath, projection)

async function verifyProjection(file) {
  const text = await fs.readFile(file, 'utf8')
  const value = JSON.parse(text)
  if (value.schemaVersion !== 'pixel-book-evidence.v1') throw new Error('pixel_book_evidence_schema_invalid')
  if (value.source?.sourceEventCount <= value.source?.publicEventCount) {
    throw new Error('pixel_book_evidence_source_projection_counts_invalid')
  }
  const expectedObserved = value.claims.filter((claim) => claim.status === 'observed').length
  const expectedPending = value.claims.filter(
    (claim) => claim.status === 'additional_observation_required',
  ).length
  if (value.counts?.observedClaims !== expectedObserved
    || value.counts?.additionalObservationRequired !== expectedPending) {
    throw new Error('pixel_book_evidence_claim_counts_invalid')
  }
  if (expectedPending > 0 && !value.events?.some((event) => event.evidenceLevel === 'Missing')) {
    throw new Error('pixel_book_evidence_missing_boundary_lost')
  }
  if (/\/Users\/|sk-ant-|AKIA|CLAUDE_CODE_OAUTH_TOKEN|hidden reasoning/i.test(text)) {
    throw new Error('pixel_book_evidence_private_content_detected')
  }
  process.stdout.write(`Verified ${value.events.length} Pixel evidence events in ${file}\n`)
}

async function updateCatalog(file, evidencePath, value) {
  const catalog = await fs.readFile(file, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => ({
      schemaVersion: 'pixel-book-evidence-catalog.v1',
      title: 'Book SDK 실제 실행 증거',
      entries: [],
    }))
  if (catalog.schemaVersion !== 'pixel-book-evidence-catalog.v1' || !Array.isArray(catalog.entries)) {
    throw new Error('pixel_book_evidence_catalog_invalid')
  }
  const relativePath = path.relative(path.dirname(file), evidencePath).split(path.sep).join('/')
  const entry = {
    chapterSlug: value.source.chapterSlug,
    title: value.title,
    path: relativePath.startsWith('.') ? relativePath : `./${relativePath}`,
    campaignId: value.source.campaignId,
    model: value.source.model,
    sourceEventCount: value.source.sourceEventCount,
    publicEventCount: value.source.publicEventCount,
    observedClaims: value.counts.observedClaims,
    additionalObservationRequired: value.counts.additionalObservationRequired,
    artifactSha256: sha256(await fs.readFile(evidencePath, 'utf8')),
  }
  catalog.entries = catalog.entries
    .filter((candidate) => candidate.chapterSlug !== entry.chapterSlug)
    .concat(entry)
    .sort((left, right) => chapterNumber(left.chapterSlug) - chapterNumber(right.chapterSlug))
  catalog.generatedAt = new Date().toISOString()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`)
}

function chapterNumber(value) {
  return Number(String(value).replace(/^ch/, '')) || Number.MAX_SAFE_INTEGER
}

function pixelState(event) {
  if (event.eventType === 'prompt.submitted') return 'briefing'
  if (event.eventType === 'sdk.init') return 'ready'
  if (event.eventType === 'tool.use') return 'working'
  if (event.eventType === 'tool.result') {
    return event?.attributes?.outcome === 'cancelled' ? 'cancelled' : 'completed'
  }
  if (event.eventType === 'assistant.claim') {
    return event?.attributes?.status === 'observed' ? 'verified' : 'needs-evidence'
  }
  if (event.eventType === 'result.completed') return 'terminal'
  if (event?.attributes?.control === 'interrupt') return 'interrupted'
  if (event.eventType === 'hook.event') return 'working'
  return 'observed'
}

function safeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
}

function safeRefs(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string').slice(0, 12)
    : []
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringValue(...values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || ''
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function requiredValue(flag) {
  const value = valueAfter(flag)
  if (!value) throw new Error(`missing_argument: ${flag}`)
  return value
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
