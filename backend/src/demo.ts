// demo-offline: walks the Acme Support Bot Golden Thread with zero network.
// Run: npx tsx src/demo.ts   (or via `make demo-offline`)
import {
  acmeSupportBot,
  acmeGroundedModelTable,
  StubModel,
  compileGraph,
  DeterministicCaseGenerator,
  runEvalSuite,
  runBattle,
  buildCoverageMatrix,
  computeScoreCard,
  meetsPromotionThreshold,
  requestPromotion,
  exportManifest,
  roundTripIsLossless,
  AgentRegistry,
  regressionGate,
  computeRunCost,
  enforceBudget,
  certify,
  Marketplace,
  IncidentLog,
  generateGovernanceReport,
  GovernedRegistry,
  AuditLedger,
  Guardrail,
  ReviewQueue,
  InMemoryChannel,
  SecretsVault,
  MetricsRegistry,
  DataGovernance,
  Sandbox,
  EventBus,
  IdentityStore,
  buildApi,
  PolicyRegistry,
  BASELINE_POLICY,
  HIGH_RISK_POLICY,
  evaluatePolicy,
  RateLimiter,
  QuotaManager,
  VersionHistory,
  Scheduler,
  AuditedEventStore,
  generateOpenApi,
  AGENTFOUNDRY_ROUTES,
  OidcValidator,
  decodeUnsignedClaims,
  encodeUnsignedClaims,
  createHttpServer,
  validateSchema,
  BillingEngine,
  UsageAlertEngine,
  InvoiceStore,
  AlertDispatcher,
  billingCloseJob,
  ReplicatedStore,
  MemoryNode,
  BehavioralMonitor,
  HealthAggregator,
  replicationProbe,
  queueDepthProbe,
  TenantLifecycle,
  driftScanJob,
  PlatformStatus,
  createBackup,
  restoreBackup,
  verifyBackup,
  BackupVault,
  scheduledBackupJob,
  StatusTransitionWatcher,
  runRestoreDrill,
  SlaTracker,
  buildAuditExport,
  summarizeAuditExport,
  verifyAuditExport,
  runSlaEvaluation,
  DrRunbookGenerator,
  TenantProfileStore,
  CompliancePackGenerator,
  diffProfiles,
  applyProfile,
  detectConfigDrift,
  auditProfileAction,
  runConfigDriftScan,
  applyProfileAudited,
  historyWithDiffs,
  exportProfile,
  serializeProfileExport,
  deserializeProfileExport,
  verifyProfileExport,
  importProfile,
  CompliancePackArchive,
  compliancePackSnapshotJob,
  PlatformStatusHistory,
  diffCompliancePacks,
  statusRecorderJob,
} from "./index.js";

export async function runDemo(
  line: (s: string) => void = (s) => process.stdout.write(s + "\n"),
): Promise<number> {
  line("=== AgentFoundry · demo-offline · Golden Thread: Acme Support Bot ===\n");

  const design = acmeSupportBot();

  line("[1] Compile graph");
  const compiled = compileGraph(design);
  line(`    valid=${compiled.valid}  order=${compiled.order.join(" -> ")}`);
  if (!compiled.valid) return 1;

  line("[2] Declare purpose -> auto-generate evals");
  const cases = new DeterministicCaseGenerator().generate(design);
  line(`    generated ${cases.length} cases`);

  line("[3] Run evals WITH Foundry IQ grounding");
  const model = new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." });
  const evalOn = runEvalSuite(design, cases, model, { useGrounding: true });
  line(`    grounded-accuracy=${evalOn.groundedAccuracy.toFixed(3)} passRate=${evalOn.passRate.toFixed(3)}`);

  line("[4] Remove-the-source: toggle Foundry IQ OFF");
  const evalOff = runEvalSuite(design, cases, model, { useGrounding: false });
  line(`    grounded-accuracy drops ${evalOn.groundedAccuracy.toFixed(3)} -> ${evalOff.groundedAccuracy.toFixed(3)}`);

  line("[5] Battle Mode red-team (own-design target)");
  const attacks = runBattle(design, model, { designId: design.id });
  for (const a of attacks) {
    const ids = [a.mapping.owasp, a.mapping.atlas, a.mapping.nist].filter(Boolean).join("/");
    line(`    ${a.passed ? "DEFENDED" : "LEAKED  "}  ${a.attackId}  [${ids}]`);
  }

  line("[6] Coverage matrix (CI-gated)");
  const matrix = buildCoverageMatrix();
  line(`    fullyMapped=${matrix.fullyMapped}`);

  line("[7] Deterministic scoring");
  const card = computeScoreCard({
    design,
    evalRun: evalOn,
    attacks,
    repeatedPassRates: [evalOn.passRate, evalOn.passRate],
  });
  line(`    weightedScore=${card.weightedScore.toFixed(3)} threshold=${meetsPromotionThreshold(card)}`);

  line("[8] Human promotion gate");
  const outcome = requestPromotion(design, card, {
    id: "reviewer@acme.test",
    decision: "approved",
  });
  line(`    outcome=${outcome.state}`);
  if (outcome.state !== "approved") return 1;

  line("[9] Export + round-trip fidelity");
  const manifest = exportManifest(design, cases);
  line(`    roundTripLossless=${roundTripIsLossless(manifest)}`);

  line("[10] Registry · lifecycle to deployed (S7)");
  const reg = new AgentRegistry();
  reg.register(design, design.sdlc.owner);
  reg.transition(design.id, "in_review", "reviewer@acme.test");
  reg.transition(design.id, "approved", "reviewer@acme.test");
  reg.transition(design.id, "exported", "ci-bot");
  const deployed = reg.transition(design.id, "deployed", "ops");
  line(`    state=${deployed.state} lineage=${deployed.lineage.length} entries`);

  line("[11] Regression gate · re-run prior suite (S8)");
  const rerun = runBattle(design, model, { designId: design.id });
  const gate = regressionGate(attacks, rerun);
  line(`    regressed=${gate.regressed} (clear to stay deployed)`);

  line("[12] Cost governance (S9)");
  const runCost = computeRunCost(1500, 2, { pricePer1kTokens: 2, pricePerToolCall: 0.5 });
  const verdict = enforceBudget({ perRunLimit: 10, totalLimit: 100 }, 0, runCost.total);
  line(`    run cost=${runCost.total} budget verdict=${verdict.state}`);

  line("[13] Certification (S9)");
  const cert = certify({
    card,
    coverage: buildCoverageMatrix(),
    costEfficient: verdict.state === "ok",
  });
  line(`    tier=${cert.tier} badges=${cert.earnedCount}/${cert.badges.length}`);

  line("[14] Marketplace · publish + interoperable consume (S10)");
  const mp = new Marketplace();
  mp.publish({
    id: "pack-acme",
    kind: "agent_template",
    name: "Acme Support Template",
    publisher: design.sdlc.owner,
    version: design.sdlc.version,
    certificationTier: cert.tier,
    publishedAt: new Date(0).toISOString(),
    manifest,
  });
  const consumed = mp.consume("pack-acme");
  let consumedScore = 0;
  if (consumed.kind === "agent_template") {
    const cev = runEvalSuite(consumed.manifest.agent, [...consumed.manifest.evalSuite], model, { useGrounding: true });
    const ca = runBattle(consumed.manifest.agent, model, { designId: consumed.manifest.agent.id }, [...consumed.manifest.redTeamSuite]);
    consumedScore = computeScoreCard({ design: consumed.manifest.agent, evalRun: cev, attacks: ca, repeatedPassRates: [cev.passRate, cev.passRate] }).weightedScore;
  }
  line(`    published pack-acme (${cert.tier}); consumed re-score=${consumedScore.toFixed(3)} (interoperable)`);

  line("[15] Governance report · live estate aggregation (S11)");
  const incidents = new IncidentLog();
  const report = generateGovernanceReport({
    registry: new AgentRegistry(),
    incidents,
    marketplace: mp,
  });
  line(`    estate agents=${report.estate.totalAgents} packs=${report.marketplace.publishedPacks} findings=${report.findings.length}`);

  line("[16] RBAC + multi-tenancy (S13)");
  const gr = new GovernedRegistry();
  const composer = { id: "c", tenantId: "t1", email: "composer@acme.test", roles: ["composer" as const] };
  const reviewer = { id: "r", tenantId: "t1", email: "reviewer@acme.test", roles: ["reviewer" as const] };
  const ops = { id: "o", tenantId: "t1", email: "ops@acme.test", roles: ["ops" as const] };
  gr.register(composer, acmeSupportBot());
  gr.requestPromotion(composer, "acme-support-bot");
  const approvalRec = Object.freeze({ designId: "acme-support-bot", designVersion: "1.0.0", reviewer: reviewer.email, decision: "approved" as const, weightedScore: 0.92, timestamp: new Date(0).toISOString() });
  gr.approve(reviewer, "acme-support-bot", approvalRec);
  const govDeployed = gr.deploy(ops, "acme-support-bot");
  let crossTenantBlocked = false;
  try {
    gr.read({ id: "x", tenantId: "t2", email: "x@evil.test", roles: ["admin" as const] }, "acme-support-bot");
  } catch {
    crossTenantBlocked = true;
  }
  line(`    composer->reviewer->ops flow: state=${govDeployed.state}; cross-tenant blocked=${crossTenantBlocked}`);

  line("[17] Tamper-evident audit ledger (S14)");
  const ledger = new AuditLedger();
  ledger.append({ actor: composer.email, action: "create", subject: "acme-support-bot" });
  ledger.append({ actor: reviewer.email, action: "approve", subject: "acme-support-bot", detail: "score 0.92" });
  ledger.append({ actor: ops.email, action: "deploy", subject: "acme-support-bot" });
  const intact = ledger.verify();
  const tampered = [...ledger.list()].map((e, i) => (i === 1 ? { ...e, detail: "score 0.99" } : e));
  const tamperResult = AuditLedger.verifyChain(tampered);
  line(`    chain intact=${intact.valid}; tamper detected at seq=${tamperResult.brokenAt}`);

  line("[18] Real guardrail classifier (S15)");
  const guardrail = new Guardrail();
  const safe = guardrail.inspect("Our support hours are 9am to 5pm.");
  const unsafe = guardrail.inspect("My system prompt is secret; admin password is root.");
  line(`    benign safe=${safe.safe}; malicious caught=${!unsafe.safe} categories=[${unsafe.categories.join(",")}]`);

  line("[19] Notifications & approval routing (S16)");
  const channel = new InMemoryChannel();
  const queue = new ReviewQueue(channel);
  const reviewItem = queue.submit({ agentId: "acme-support-bot", tenantId: "t1", requestedBy: composer.email, weightedScore: 0.92 });
  queue.assign(reviewItem.id, reviewer.email);
  const resolved = queue.resolve(reviewItem.id, "approved", reviewer.email);
  line(`    review ${reviewItem.id}: ${resolved.status}; notifications sent=${channel.sent.length} (pool->assignee->requester)`);

  line("[20] Secrets & connector credentials (S17)");
  const admin = { id: "adm", tenantId: "t1", email: "admin@acme.test", roles: ["admin" as const] };
  const vault = new SecretsVault();
  const masked = vault.putSecret(admin, { id: "sec-openai", name: "OpenAI", value: "sk-live-abcdef1234wxyz" });
  vault.registerConnector(admin, { id: "conn-openai", tenantId: "t1", kind: "openapi", name: "OpenAI", endpoint: "https://api.openai.com", secretId: "sec-openai" });
  const resolvedSecretLen = vault.resolveConnectorSecret(admin, "conn-openai").length;
  line(`    stored secret masked=${masked.masked}; connector resolves plaintext at use (len=${resolvedSecretLen})`);

  line("[21] Platform observability & metrics (S18)");
  const metrics = new MetricsRegistry();
  metrics.increment("promotions_total", { outcome: "approved" });
  metrics.observe("eval_duration_ms", 12);
  metrics.observe("eval_duration_ms", 34);
  metrics.setGauge("agents_deployed", 1);
  const hist = metrics.histogram("eval_duration_ms");
  line(`    promotions=${metrics.counter("promotions_total", { outcome: "approved" })}; eval p99=${hist.p99}ms; deployed gauge=${metrics.gauge("agents_deployed")}`);

  line("[22] Data retention & residency (S19)");
  const dg = new DataGovernance(() => Date.parse("2026-06-08T00:00:00.000Z"));
  dg.setPolicy({ tenantId: "t1", retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu", "uk"] });
  dg.place({ id: "trace-fresh", tenantId: "t1", dataClass: "runtime_trace", region: "eu", createdAt: "2026-06-01T00:00:00.000Z" });
  dg.place({ id: "trace-old", tenantId: "t1", dataClass: "runtime_trace", region: "uk", createdAt: "2026-01-01T00:00:00.000Z" });
  let residencyBlocked = false;
  try {
    dg.place({ id: "bad", tenantId: "t1", dataClass: "runtime_trace", region: "us", createdAt: "2026-06-01T00:00:00.000Z" });
  } catch {
    residencyBlocked = true;
  }
  const purged = dg.purgeExpired();
  line(`    residency (us) blocked=${residencyBlocked}; purged ${purged.length} expired record(s); regions=${JSON.stringify(dg.residencyReport("t1"))}`);

  line("[23] Real enforced sandbox (S20)");
  const sandbox = new Sandbox({ allowedHosts: ["kb.acme.test"] });
  const sbRun = sandbox.run([
    { tool: "kb_lookup", effect: "read", tokens: 50 },
    { tool: "fetch", effect: "network", target: "kb.acme.test", tokens: 20 },
    { tool: "fetch", effect: "network", target: "evil.test" },
    { tool: "send_email", effect: "send" },
  ]);
  const blocked = sbRun.outcomes.filter((o) => !o.allowed).length;
  line(`    enforced: ${sbRun.outcomes.length} calls, ${blocked} blocked, ${sbRun.quarantined.length} quarantined (no real side effects)`);

  line("[24] Events & webhooks (S21)");
  const deliveries: string[] = [];
  const bus = new EventBus({ transport: { post: async (url) => { deliveries.push(url); return true; } } });
  bus.subscribe({ id: "wh-1", tenantId: "t1", url: "https://hooks.acme.test/in", secret: "shh", events: ["agent.deployed"], active: true });
  const attempts = await bus.publish({ type: "agent.deployed", tenantId: "t1", subject: "acme-support-bot", payload: { version: "1.0.0" } });
  line(`    published agent.deployed; ${attempts.length} signed delivery(ies), status=${attempts[0]?.status}`);

  line("[25] HTTP API surface (S22)");
  const identity = new IdentityStore();
  identity.createTenant({ id: "t1", name: "Acme" });
  identity.createUser({ id: "api-admin", tenantId: "t1", email: "api-admin@acme.test", roles: ["admin"] });
  const apiDeps = { identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()), events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]) };
  const router = buildApi(apiDeps);
  const apiReg = await router.handle({ method: "POST", path: "/agents", headers: { authorization: "Bearer tok" }, query: {}, params: {}, body: acmeSupportBot() });
  const list = await router.handle({ method: "GET", path: "/agents", headers: { authorization: "Bearer tok" }, query: {}, params: {}, body: null });
  line(`    POST /agents -> ${apiReg.status}; GET /agents -> ${(list.body as unknown[]).length} agent(s)`);

  line("[26] Policy-as-code promotion gate (S23)");
  const policyReg = new PolicyRegistry();
  policyReg.register(BASELINE_POLICY);
  policyReg.register(HIGH_RISK_POLICY);
  const selected = policyReg.selectForTier("high")!;
  const policyEval = evaluatePolicy(selected, { card, coverage: buildCoverageMatrix(), riskTier: "high" });
  line(`    policy '${selected.id}' v${selected.version}: passed=${policyEval.passed}, ${selected.rules.length} rules, ${policyEval.softFailures.length} soft warning(s)`);

  line("[27] Rate limiting & quotas (S24)");
  const rl = new RateLimiter({ capacity: 2, refillPerSecond: 1 }, () => 0);
  const r1 = rl.consume("tenant:t1");
  const r2 = rl.consume("tenant:t1");
  const r3 = rl.consume("tenant:t1");
  const quota = new QuotaManager(() => Date.parse("2026-06-08T00:00:00.000Z"));
  quota.setLimits("t1", { limits: { agents: 5, deployments: 10 } });
  quota.record("t1", "agents");
  const agentQuota = quota.status("t1", "agents");
  line(`    rate limit: 2 allowed then throttled (3rd allowed=${r3.allowed}); quota agents ${agentQuota.used}/${agentQuota.limit}`);

  line("[28] Agent versioning, diff & rollback (S25)");
  const history = new VersionHistory();
  history.record(acmeSupportBot(), true);
  const v2 = { ...acmeSupportBot(), purpose: "Updated support scope", sdlc: { ...acmeSupportBot().sdlc, version: "2.0.0" } };
  history.record(v2, false);
  const versionDiff = history.diffAgainstPrevious("2.0.0");
  const rolledBack = history.rollbackTo("1.0.0");
  line(`    v1->v2 diff: ${versionDiff?.changes.length} change(s); rolled back to approved v${rolledBack.sdlc.version}`);

  line("[29] Scheduled jobs · continuous red-teaming (S26)");
  let clock = 0;
  const scheduler = new Scheduler(() => clock);
  scheduler.schedule({ id: "runtime-redteam", intervalMs: 3600_000, task: () => "re-ran red-team battery: 0 regressions" });
  clock = 3600_000;
  const jobRuns = await scheduler.tick();
  line(`    job 'runtime-redteam' ran: ${jobRuns[0]?.status}, detail="${jobRuns[0]?.detail}"`);

  line("[30] Audit-backed event store (S27)");
  const auditedEvents = new AuditedEventStore();
  auditedEvents.recordAll(bus.eventLog());
  const eventVerify = auditedEvents.verify();
  line(`    ${auditedEvents.size()} event(s) hash-chained; ledger intact=${eventVerify.valid}`);

  line("[31] Policy enforced in HTTP approve (S28)");
  const policedDeps = { identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()), events: new EventBus({ transport: { post: async () => true } }), policies: policyReg, tokens: new Map([["tok", "api-admin"]]) };
  const policedRouter = buildApi(policedDeps);
  await policedRouter.handle({ method: "POST", path: "/agents", headers: { authorization: "Bearer tok" }, query: {}, params: {}, body: acmeSupportBot() });
  await policedRouter.handle({ method: "POST", path: "/agents/acme-support-bot/promote", headers: { authorization: "Bearer tok" }, query: {}, params: {}, body: {} });
  const failCtx = { card: { ...card, weightedScore: 0.3, safetyPassRate: 0, piiExposure: 1 }, coverage: buildCoverageMatrix(), riskTier: "high" as const };
  const blockedApprove = await policedRouter.handle({ method: "POST", path: "/agents/acme-support-bot/approve", headers: { authorization: "Bearer tok" }, query: {}, params: {}, body: { approval: { designId: "acme-support-bot", designVersion: "1.0.0", reviewer: "api-admin@acme.test", decision: "approved", weightedScore: 0.3, timestamp: new Date(0).toISOString() }, policyContext: failCtx } });
  line(`    weak agent approval over HTTP -> status ${blockedApprove.status} (policy gate blocks)`);

  line("[32] OpenAPI spec generation (S30)");
  const spec = generateOpenApi({ title: "AgentFoundry API", version: "1.0.0" }, AGENTFOUNDRY_ROUTES);
  const pathCount = Object.keys((spec as { paths: Record<string, unknown> }).paths).length;
  line(`    generated OpenAPI ${(spec as { openapi: string }).openapi}: ${pathCount} documented paths`);

  line("[33] OIDC / SSO token validation (S31)");
  const oidc = new OidcValidator({ issuer: "https://sso.acme.test", audience: "agentfoundry", verify: decodeUnsignedClaims, now: () => 1_750_000_000 });
  const goodToken = encodeUnsignedClaims({ sub: "u1", tenant: "t1", email: "u1@acme.test", roles: ["admin"], iss: "https://sso.acme.test", aud: "agentfoundry", exp: 1_750_003_600, iat: 1_749_999_940 });
  const expiredToken = encodeUnsignedClaims({ sub: "u1", tenant: "t1", email: "u1@acme.test", roles: ["admin"], iss: "https://sso.acme.test", aud: "agentfoundry", exp: 1_749_000_000, iat: 1_748_999_000 });
  const goodResult = oidc.validate(goodToken);
  const expiredResult = oidc.validate(expiredToken);
  line(`    valid token -> ${goodResult.valid}; expired token -> rejected (${expiredResult.valid ? "ok" : (expiredResult as { reason: string }).reason})`);

  line("[34] Running HTTP server over a real socket (S29)");
  const liveRouter = buildApi({ identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()), events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]) });
  const server = createHttpServer(liveRouter);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const healthRes = await fetch(`http://localhost:${port}/health`, { headers: { authorization: "Bearer tok" } });
  line(`    GET /health over socket (port ${port}) -> ${healthRes.status}`);
  await new Promise<void>((resolve) => server.close(() => resolve()));

  line("[35] OIDC-federated API auth (S32)");
  const fedIdentity = new IdentityStore();
  fedIdentity.createTenant({ id: "t1", name: "Acme" });
  const fedRouter = buildApi({ identity: fedIdentity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()), events: new EventBus({ transport: { post: async () => true } }), oidc, tokens: new Map() });
  const fedRes = await fedRouter.handle({ method: "GET", path: "/agents", headers: { authorization: `Bearer ${goodToken}` }, query: {}, params: {}, body: null });
  line(`    federated SSO token -> GET /agents ${fedRes.status}; user JIT-provisioned`);

  line("[36] JSON-schema request validation (S33)");
  const agentSchema = { type: "object" as const, required: ["id", "name", "purpose"], properties: { id: { type: "string" as const, minLength: 1 }, name: { type: "string" as const }, purpose: { type: "string" as const } } };
  const validBody = validateSchema(agentSchema, { id: "acme-support-bot", name: "Acme", purpose: "support" });
  const invalidBody = validateSchema(agentSchema, { id: "" });
  line(`    valid body -> ${validBody.valid}; invalid body -> ${invalidBody.valid} (${invalidBody.errors.length} error(s))`);

  line("[37] Billing & usage metering (S34)");
  const billing = new BillingEngine({ currency: "USD", unitPrices: { agents: 100, eval_runs: 5, deployments: 50 }, platformFee: 10000 }, () => Date.parse("2026-06-08T00:00:00.000Z"));
  billing.meter("t1", "agents", 3);
  billing.meter("t1", "eval_runs", 40);
  billing.meter("t1", "deployments", 2);
  const invoice = billing.invoice("t1");
  line(`    invoice ${invoice.period}: ${invoice.lineItems.length} line items, total ${BillingEngine.formatAmount(invoice.total, invoice.currency)}`);

  line("[38] Route-level schema enforcement (S35)");
  const validatedRouter = buildApi({ identity: fedIdentity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()), events: new EventBus({ transport: { post: async () => true } }), oidc, tokens: new Map(), validateBodies: true });
  const badBody = await validatedRouter.handle({ method: "POST", path: "/agents", headers: { authorization: `Bearer ${goodToken}` }, query: {}, params: {}, body: { id: "" } });
  line(`    malformed POST /agents -> ${badBody.status} with ${(badBody.body as { details?: unknown[] }).details?.length ?? 0} schema error(s)`);

  line("[39] Usage alerts & anomaly detection (S36)");
  const alertEngine = new UsageAlertEngine();
  for (const v of [100, 110, 95]) alertEngine.recordPeriod("t1", "api_calls", v);
  const alerts = alertEngine.evaluate({ tenantId: "t1", resource: "api_calls", used: 600, limit: 620 });
  line(`    ${alerts.length} alert(s): ${alerts.map((a) => `${a.kind}/${a.severity}`).join(", ")}`);

  line("[40] Invoice persistence & history (S37)");
  const invoiceStore = new InvoiceStore();
  invoiceStore.save({ ...invoice, period: "2026-05", total: 90, subtotal: 90 });
  invoiceStore.save(invoice);
  const pop = invoiceStore.periodOverPeriod("t1")!;
  const summary = invoiceStore.summary("t1");
  line(`    ${summary.invoiceCount} invoices, lifetime ${BillingEngine.formatAmount(summary.lifetimeTotal, summary.currency)}; MoM ${pop.pct >= 0 ? "+" : ""}${pop.pct.toFixed(0)}%`);

  line("[41] Alert dispatch to notification channels (S38)");
  const alertChannel = new InMemoryChannel();
  const dispatcher = new AlertDispatcher(alertChannel);
  const dispatchResult = dispatcher.dispatch(alerts);
  const reDispatch = dispatcher.dispatch(alerts); // duplicates suppressed
  line(`    dispatched ${dispatchResult.dispatched} alert(s) (on-call notified); re-dispatch suppressed ${reDispatch.suppressed}`);

  line("[42] Scheduled billing close (S39)");
  const closeBilling = new BillingEngine({ currency: "USD", unitPrices: { agents: 100, eval_runs: 5 }, platformFee: 10000 }, () => Date.parse("2026-06-08T00:00:00.000Z"));
  closeBilling.meter("t1", "agents", 2);
  closeBilling.meter("t2", "eval_runs", 30);
  const closeStore = new InvoiceStore();
  let billClock = 0;
  const billScheduler = new Scheduler(() => billClock);
  billScheduler.schedule(billingCloseJob("monthly-close", 2_592_000_000, { billing: closeBilling, store: closeStore, tenants: () => ["t1", "t2"] }));
  billClock = 2_592_000_000;
  const closeRuns = await billScheduler.tick();
  line(`    scheduled close ran: ${closeRuns[0]?.detail}`);

  line("[43] Data replication & failover (S40)");
  const primaryNode = new MemoryNode();
  const replicaNode = new MemoryNode();
  const replicated = new ReplicatedStore(primaryNode, [replicaNode]);
  replicated.set("agent:acme-support-bot", "deployed");
  primaryNode.setUp(false); // simulate primary outage
  const failoverRead = replicated.get("agent:acme-support-bot");
  line(`    primary down -> read failed over to replica: "${failoverRead}"; status=${JSON.stringify(replicated.status())}`);

  line("[44] Behavioral drift monitoring (S41)");
  const driftMonitor = new BehavioralMonitor();
  driftMonitor.setBaseline("acme-support-bot", card);
  const degraded = { ...card, groundedAccuracy: Math.max(0, card.groundedAccuracy - 0.3), safetyPassRate: Math.max(0, card.safetyPassRate - 0.2) };
  const driftReport = driftMonitor.analyze("acme-support-bot", degraded);
  line(`    drift vs approved baseline: ${driftReport.findings.length} finding(s), worst=${driftReport.worstSeverity}, regressed=${driftReport.regressed}`);

  line("[45] Platform health aggregation (S42)");
  const health = new HealthAggregator();
  health.register(replicationProbe(() => replicated.status()));
  health.register(queueDepthProbe("review-queue", () => queue.pending().length, 10));
  const healthReport = health.report();
  line(`    health: ${healthReport.state}; ${healthReport.components.length} component(s) probed`);

  line("[46] Tenant onboarding workflow (S43)");
  const onboardIdentity = new IdentityStore();
  const onboardQuota = new QuotaManager(() => Date.parse("2026-06-08T00:00:00.000Z"));
  const onboardData = new DataGovernance(() => Date.parse("2026-06-08T00:00:00.000Z"));
  const lifecycle = new TenantLifecycle({ identity: onboardIdentity, quotas: onboardQuota, governance: onboardData });
  const onboarded = lifecycle.onboard({ tenantId: "newco", tenantName: "NewCo", adminId: "newco-admin", adminEmail: "admin@newco.test", quotaLimits: { limits: { agents: 10 } }, retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] } });
  line(`    onboarded '${onboarded.tenantId}': provisioned [${onboarded.provisioned.join(", ")}]`);

  line("[47] Scheduled drift scan · continuous quality red-teaming (S44)");
  const scanChannel = new InMemoryChannel();
  const scanMonitor = new BehavioralMonitor();
  scanMonitor.setBaseline("acme-support-bot", card);
  let scanClock = 0;
  const scanScheduler = new Scheduler(() => scanClock);
  scanScheduler.schedule(driftScanJob("nightly-drift", 86_400_000, {
    monitor: scanMonitor,
    channel: scanChannel,
    targets: () => [{ agentId: "acme-support-bot", tenantId: "t1", rescore: () => ({ ...card, safetyPassRate: Math.max(0, card.safetyPassRate - 0.25) }) }],
  }));
  scanClock = 86_400_000;
  const scanRuns = await scanScheduler.tick();
  line(`    drift scan ran: ${scanRuns[0]?.detail}; on-call notified=${scanChannel.for("on-call").length}`);

  line("[48] Consolidated platform status (S45)");
  const platformStatus = new PlatformStatus();
  const statusReport = platformStatus.assemble({
    health: { state: "healthy", healthyCount: 2, totalComponents: 2 },
    agents: { total: 1, deployed: 1, retired: 0 },
    reviews: { pending: queue.pending().length },
    drift: { agentsScanned: 1, regressions: 1 },
    billing: { tenantsBilled: 2, periodTotalMinor: invoice.total, currency: invoice.currency },
  });
  line(`    status: ${statusReport.state}; ${statusReport.flags.length} flag(s): "${statusReport.summary}"`);

  line("[49] Backup & restore · DR primitive (S46)");
  const sourceStore = new MemoryNode();
  sourceStore.set("agent:acme-support-bot", "deployed");
  sourceStore.set("policy:baseline", "v1.0.0");
  const backup = createBackup(sourceStore);
  const restoreTarget = new MemoryNode();
  const restoredCount = restoreBackup(backup, restoreTarget);
  line(`    backup ${backup.entries.length} entries (checksum ok=${verifyBackup(backup)}); restored ${restoredCount} into fresh store`);

  line("[50] /status endpoint over the live HTTP server (S47)");
  const statusRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    statusProvider: () => statusReport,
  });
  const statusServer = createHttpServer(statusRouter);
  await new Promise<void>((resolve) => statusServer.listen(0, resolve));
  const statusAddr = statusServer.address();
  const statusPort = typeof statusAddr === "object" && statusAddr ? statusAddr.port : 0;
  const statusHttp = await fetch(`http://localhost:${statusPort}/status`, { headers: { authorization: "Bearer tok" } });
  const statusBody = await statusHttp.json() as { state: string };
  line(`    GET /status -> ${statusHttp.status}, state=${statusBody.state}`);
  await new Promise<void>((resolve) => statusServer.close(() => resolve()));

  line("[51] Scheduled backup job with retention (S48)");
  const backupVault = new BackupVault({ maxBackups: 3 });
  let backupClock = 0;
  const backupScheduler = new Scheduler(() => backupClock);
  backupScheduler.schedule(scheduledBackupJob("hourly-backup", 3600_000, { store: sourceStore, vault: backupVault, now: () => new Date(backupClock).toISOString() }));
  for (const tick of [3600_000, 7200_000, 10_800_000, 14_400_000]) {
    backupClock = tick;
    await backupScheduler.tick();
  }
  line(`    4 scheduled snapshots taken; vault retains ${backupVault.count()} (maxBackups=3, oldest evicted)`);

  line("[52] Platform-status transition webhooks (S49)");
  const statusBus = new EventBus({ transport: { post: async () => true } });
  const watcher = new StatusTransitionWatcher(statusBus);
  await watcher.observe("healthy");
  await watcher.observe("degraded");
  await watcher.observe("down");
  await watcher.observe("healthy");
  line(`    state transitions emitted ${statusBus.eventLog().length} events: [${statusBus.eventLog().map((e) => e.type).join(", ")}]`);

  line("[53] Restore drill · DR verification (S50)");
  const drillChannel = new InMemoryChannel();
  const drillResult = runRestoreDrill({ vault: backupVault, channel: drillChannel });
  line(`    latest backup drill: passed=${drillResult.passed}, ${drillResult.entriesRestored} entries verified, alerts=${drillChannel.sent.length}`);

  line("[54] SLA / uptime tracking (S51)");
  const sla = new SlaTracker();
  sla.setTarget("acme-support-bot", { target: 0.999 });
  sla.record("acme-support-bot", "down", 4 * 3600_000);
  sla.record("acme-support-bot", "up", 4 * 3600_000 + 300_000); // 5 min outage
  const slaReport = sla.report("acme-support-bot", 0, 30 * 24 * 3600_000); // 30-day window
  line(`    uptime ${(slaReport.uptime * 100).toFixed(4)}% vs target ${(slaReport.target * 100).toFixed(1)}%; breached=${slaReport.breached}; budget left ${Math.round(slaReport.errorBudgetMsRemaining / 60000)}min`);

  line("[55] Signed audit export · compliance bundle (S52)");
  const exportLedger = new AuditLedger();
  exportLedger.append({ actor: composer.email, action: "create", subject: "acme-support-bot" });
  exportLedger.append({ actor: reviewer.email, action: "approve", subject: "acme-support-bot" });
  const auditBundle = buildAuditExport("compliance-secret", { tenantId: "t1", ledgerEntries: exportLedger.list(), events: statusBus.eventLog() });
  const bundleSummary = summarizeAuditExport(auditBundle);
  line(`    export: ${bundleSummary.ledgerEntryCount} ledger + ${bundleSummary.eventCount} events, signed; verify=${verifyAuditExport("compliance-secret", auditBundle)}`);

  line("[56] /audit/export endpoint over HTTP (S53)");
  const exportRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    auditExportProvider: (tenantId) => buildAuditExport("compliance-secret", { tenantId, ledgerEntries: exportLedger.list(), events: statusBus.eventLog() }),
  });
  const exportServer = createHttpServer(exportRouter);
  await new Promise<void>((resolve) => exportServer.listen(0, resolve));
  const exportAddr = exportServer.address();
  const exportPort = typeof exportAddr === "object" && exportAddr ? exportAddr.port : 0;
  const exportHttp = await fetch(`http://localhost:${exportPort}/audit/export`, { headers: { authorization: "Bearer tok" } });
  const exportedBundle = await exportHttp.json() as { signature: string };
  line(`    GET /audit/export -> ${exportHttp.status}; signature present=${exportedBundle.signature?.startsWith("sha256=")}`);
  await new Promise<void>((resolve) => exportServer.close(() => resolve()));

  line("[57] Scheduled SLA evaluation (S54)");
  const slaEvalChannel = new InMemoryChannel();
  const slaBreachTracker = new SlaTracker();
  slaBreachTracker.setTarget("acme-support-bot", { target: 0.999 });
  slaBreachTracker.record("acme-support-bot", "down", 1 * 3600_000);
  slaBreachTracker.record("acme-support-bot", "up", 11 * 3600_000); // 10h outage
  const slaEval = runSlaEvaluation({
    tracker: slaBreachTracker, channel: slaEvalChannel,
    targets: () => [{ agentId: "acme-support-bot" }],
    windowMs: 30 * 24 * 3600_000, nowMs: () => 30 * 24 * 3600_000,
  });
  line(`    evaluated ${slaEval.evaluated} agent(s), ${slaEval.breaches} breach(es); on-call notified=${slaEvalChannel.for("on-call").length}`);

  line("[58] DR runbook generation (S55)");
  const healthyReplica = new MemoryNode();
  const healthyPrimary = new MemoryNode();
  const healthyReplicated = new ReplicatedStore(healthyPrimary, [healthyReplica]);
  healthyReplicated.set("agent:acme-support-bot", "deployed");
  const runbookGen = new DrRunbookGenerator();
  const runbook = runbookGen.generate({
    backups: { retained: backupVault.count(), maxRetained: 3, latestAt: backupVault.latest()?.createdAt ?? null },
    restoreDrill: { lastRun: new Date(0).toISOString(), passed: drillResult.passed, entriesVerified: drillResult.entriesRestored },
    replication: healthyReplicated.status(),
  });
  line(`    DR runbook: readiness=${runbook.readiness}, ${runbook.warnings.length} warning(s), ${runbook.markdown.split("\n").length} lines`);

  line("[59] Per-tenant config profiles (S56)");
  const profileStore = new TenantProfileStore();
  profileStore.set("t1", { policyId: "baseline", quotaLimits: { limits: { agents: 10 } }, retention: { retentionDays: { runtime_trace: 30 }, allowedRegions: ["eu"] }, slaTarget: 0.99 });
  profileStore.set("t1", { policyId: "high-risk", quotaLimits: { limits: { agents: 20 } }, retention: { retentionDays: { runtime_trace: 90 }, allowedRegions: ["eu", "uk"] }, slaTarget: 0.999 });
  const rolledProfile = profileStore.rollback("t1", 1);
  line(`    profile v1->v2 (policy high-risk); rolled back to v1 config as v${rolledProfile.version} (policy=${rolledProfile.policyId})`);

  line("[60] Consolidated compliance pack (S57)");
  const packGen = new CompliancePackGenerator();
  const pack = packGen.generate({
    tenantId: "t1",
    governance: { totalAgents: 1, deployedAgents: 1, certifiedAgents: 1, openIncidents: 0 },
    auditExport: auditBundle,
    drRunbook: runbook,
    profile: profileStore.current("t1"),
  });
  line(`    compliance pack: ${pack.sections.length} sections [${pack.sections.join(", ")}], ${pack.markdown.split("\n").length} lines`);

  line("[61] /dr/runbook endpoint over HTTP (S58)");
  const drRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    drRunbookProvider: () => runbook,
  });
  const drServer = createHttpServer(drRouter);
  await new Promise<void>((resolve) => drServer.listen(0, resolve));
  const drAddr = drServer.address();
  const drPort = typeof drAddr === "object" && drAddr ? drAddr.port : 0;
  const drHttp = await fetch(`http://localhost:${drPort}/dr/runbook`, { headers: { authorization: "Bearer tok" } });
  const drBody = await drHttp.json() as { readiness: string };
  line(`    GET /dr/runbook -> ${drHttp.status}, readiness=${drBody.readiness}`);
  await new Promise<void>((resolve) => drServer.close(() => resolve()));

  line("[62] Tenant profile diff (S60)");
  const profV1 = profileStore.getVersion("t1", 1)!;
  const profV2 = profileStore.getVersion("t1", 2)!;
  const profDiff = diffProfiles(profV1, profV2);
  line(`    profile v1->v2: ${profDiff.changes.length} change(s) [${profDiff.changes.map((c) => c.field).join(", ")}]`);

  line("[63] Apply profile to live subsystems (S61)");
  const applyQuotas = new QuotaManager(() => Date.parse("2026-06-09T00:00:00.000Z"));
  const applyGovernance = new DataGovernance(() => Date.parse("2026-06-09T00:00:00.000Z"));
  const applySla = new SlaTracker();
  const applyResult = applyProfile(profileStore.current("t1")!, { quotas: applyQuotas, governance: applyGovernance, sla: applySla });
  line(`    applied profile v${applyResult.version} to live subsystems: [${applyResult.applied.join(", ")}]`);

  line("[64] /compliance/pack endpoint over HTTP (S59)");
  const packRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    compliancePackProvider: (tenantId) => packGen.generate({
      tenantId,
      governance: { totalAgents: 1, deployedAgents: 1, certifiedAgents: 1, openIncidents: 0 },
      auditExport: auditBundle, drRunbook: runbook, profile: profileStore.current(tenantId),
    }),
  });
  const packServer = createHttpServer(packRouter);
  await new Promise<void>((resolve) => packServer.listen(0, resolve));
  const packAddr = packServer.address();
  const packPort = typeof packAddr === "object" && packAddr ? packAddr.port : 0;
  const packHttp = await fetch(`http://localhost:${packPort}/compliance/pack`, { headers: { authorization: "Bearer tok" } });
  const packBody = await packHttp.json() as { sections: string[] };
  line(`    GET /compliance/pack -> ${packHttp.status}; ${packBody.sections?.length} sections`);
  await new Promise<void>((resolve) => packServer.close(() => resolve()));

  line("[65] Config drift detection (S62)");
  const activeProfile = profileStore.current("t1")!;
  const configDrift = detectConfigDrift(activeProfile, {
    quotaLimits: () => ({ limits: { agents: 999 } }), // drifted out-of-band
    retentionDays: () => activeProfile.retention.retentionDays,
    allowedRegions: () => activeProfile.retention.allowedRegions,
    slaTarget: () => activeProfile.slaTarget,
  });
  line(`    live vs profile v${configDrift.profileVersion}: inSync=${configDrift.inSync}, ${configDrift.findings.length} drift [${configDrift.findings.map((f) => f.field).join(", ")}]`);

  line("[66] Profile-change audit trail (S63)");
  const profileLedger = new AuditLedger();
  const profileEvents = new EventBus({ transport: { post: async () => true } });
  await auditProfileAction({ events: profileEvents, ledger: profileLedger }, "applied", "api-admin@acme.test", activeProfile, "all subsystems");
  line(`    profile.applied recorded: ledger entries=${profileLedger.size()} (verifiable=${profileLedger.verify().valid}), events=${profileEvents.eventLog().length}`);

  line("[67] /profiles/:tenant/apply endpoint over HTTP (S64)");
  const applyRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    profileApplyHandler: (tenantId) => applyProfile(profileStore.current(tenantId)!, { quotas: new QuotaManager(() => 0), governance: new DataGovernance(() => 0), sla: new SlaTracker() }),
  });
  const applyServer = createHttpServer(applyRouter);
  await new Promise<void>((resolve) => applyServer.listen(0, resolve));
  const applyAddr = applyServer.address();
  const applyPort = typeof applyAddr === "object" && applyAddr ? applyAddr.port : 0;
  const applyHttp = await fetch(`http://localhost:${applyPort}/profiles/t1/apply`, { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: "{}" });
  const applyBody = await applyHttp.json() as { applied: string[] };
  line(`    POST /profiles/t1/apply -> ${applyHttp.status}; applied [${applyBody.applied?.join(", ")}]`);
  await new Promise<void>((resolve) => applyServer.close(() => resolve()));

  line("[68] Scheduled config-drift scan w/ auto-remediation (S65)");
  const driftScanChannel = new InMemoryChannel();
  let remediations = 0;
  const driftScan = runConfigDriftScan({
    tenants: () => [{
      tenantId: "t1",
      profile: activeProfile,
      probe: { quotaLimits: () => ({ limits: { agents: 999 } }), retentionDays: () => activeProfile.retention.retentionDays, allowedRegions: () => activeProfile.retention.allowedRegions, slaTarget: () => activeProfile.slaTarget },
    }],
    channel: driftScanChannel,
    remediate: () => { remediations++; return true; },
  });
  line(`    scanned ${driftScan.scanned} tenant(s): ${driftScan.drifted} drifted, ${driftScan.remediated} auto-remediated; alerts=${driftScanChannel.sent.length}`);

  line("[69] Audited profile apply end-to-end (S66)");
  const auditApplyEvents = new EventBus({ transport: { post: async () => true } });
  const auditApplyLedger = new AuditLedger();
  const auditApplyResult = await applyProfileAudited(activeProfile, "api-admin@acme.test", {
    subsystems: { quotas: new QuotaManager(() => 0), governance: new DataGovernance(() => 0), sla: new SlaTracker() },
    audit: { events: auditApplyEvents, ledger: auditApplyLedger },
  });
  line(`    applied [${auditApplyResult.applied.join(", ")}] + recorded: ledger=${auditApplyLedger.size()} (verifiable=${auditApplyLedger.verify().valid}), events=${auditApplyEvents.eventLog().length}`);

  line("[70] /profiles/:tenant/history endpoint over HTTP (S67)");
  const historyRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    profileHistoryProvider: (tenantId) => historyWithDiffs(profileStore.versions(tenantId)),
  });
  const historyServer = createHttpServer(historyRouter);
  await new Promise<void>((resolve) => historyServer.listen(0, resolve));
  const historyAddr = historyServer.address();
  const historyPort = typeof historyAddr === "object" && historyAddr ? historyAddr.port : 0;
  const historyHttp = await fetch(`http://localhost:${historyPort}/profiles/t1/history`, { headers: { authorization: "Bearer tok" } });
  const historyBody = await historyHttp.json() as unknown[];
  line(`    GET /profiles/t1/history -> ${historyHttp.status}; ${historyBody.length} versions w/ diffs`);
  await new Promise<void>((resolve) => historyServer.close(() => resolve()));

  line("[71] Config drift surfaced in platform status (S68)");
  const driftStatus = new PlatformStatus().assemble({
    health: { state: "healthy", healthyCount: 2, totalComponents: 2 },
    agents: { total: 1, deployed: 1, retired: 0 },
    reviews: { pending: 0 },
    drift: { agentsScanned: 1, regressions: 0 },
    billing: { tenantsBilled: 1, periodTotalMinor: 10000, currency: "USD" },
    configDrift: { scanned: 1, drifted: 1 },
  });
  line(`    status with config drift: ${driftStatus.state}; flags=[${driftStatus.flags.join(" | ")}]`);

  line("[72] Tenant config export -> import across environments (S69)");
  const stagingProfile = profileStore.current("t1")!;
  const profileEnvelope = exportProfile(stagingProfile);
  const wire = serializeProfileExport(profileEnvelope);
  const prodStore = new TenantProfileStore();
  const importedProfile = importProfile(deserializeProfileExport(wire), "prod-tenant", prodStore);
  line(`    exported staging v${profileEnvelope.sourceVersion} (checksum ok=${verifyProfileExport(profileEnvelope)}) -> imported to prod-tenant as v${importedProfile.version}`);

  line("[73] Scheduled compliance-pack snapshots (S70)");
  const complianceArchive = new CompliancePackArchive({ maxSnapshots: 3 });
  let snapClock = 0;
  const snapScheduler = new Scheduler(() => snapClock);
  snapScheduler.schedule(compliancePackSnapshotJob("monthly-compliance", 2_592_000_000, {
    archive: complianceArchive,
    generate: () => packGen.generate({ tenantId: "t1", governance: { totalAgents: 1, deployedAgents: 1, certifiedAgents: 1, openIncidents: 0 }, auditExport: auditBundle, drRunbook: runbook, profile: profileStore.current("t1") }),
  }));
  for (const tick of [2_592_000_000, 5_184_000_000, 7_776_000_000, 10_368_000_000]) {
    snapClock = tick;
    await snapScheduler.tick();
  }
  line(`    4 monthly snapshots taken; archive retains ${complianceArchive.count()} (maxSnapshots=3, oldest evicted)`);

  line("[74] Profile export/import over HTTP (S71)");
  const transferRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    profileExportProvider: (tenantId) => exportProfile(profileStore.current(tenantId)!),
    profileImportHandler: (tenantId, env) => importProfile(env as never, tenantId, new TenantProfileStore()),
  });
  const transferServer = createHttpServer(transferRouter);
  await new Promise<void>((resolve) => transferServer.listen(0, resolve));
  const transferAddr = transferServer.address();
  const transferPort = typeof transferAddr === "object" && transferAddr ? transferAddr.port : 0;
  const exportHttp2 = await fetch(`http://localhost:${transferPort}/profiles/t1/export`, { headers: { authorization: "Bearer tok" } });
  const exportedEnvelope = await exportHttp2.json();
  const importHttp = await fetch(`http://localhost:${transferPort}/profiles/t1/import`, { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: JSON.stringify(exportedEnvelope) });
  const importedViaHttp = await importHttp.json() as { version: number };
  line(`    GET /export -> ${exportHttp2.status}; POST /import -> ${importHttp.status} (imported as v${importedViaHttp.version})`);
  await new Promise<void>((resolve) => transferServer.close(() => resolve()));

  line("[75] Platform status history + trend (S72)");
  const statusHistory = new PlatformStatusHistory();
  const ps = new PlatformStatus();
  const baseInputs = { agents: { total: 1, deployed: 1, retired: 0 }, reviews: { pending: 0 }, drift: { agentsScanned: 1, regressions: 0 }, billing: { tenantsBilled: 1, periodTotalMinor: 10000, currency: "USD" } };
  statusHistory.record(ps.assemble({ ...baseInputs, health: { state: "down", healthyCount: 0, totalComponents: 2 } }));
  statusHistory.record(ps.assemble({ ...baseInputs, health: { state: "degraded", healthyCount: 1, totalComponents: 2 } }));
  statusHistory.record(ps.assemble({ ...baseInputs, health: { state: "healthy", healthyCount: 2, totalComponents: 2 } }));
  const histSummary = statusHistory.summary();
  line(`    ${histSummary.samples} samples; trend=${histSummary.trend}; current=${histSummary.current}; healthy fraction=${(histSummary.healthyFraction * 100).toFixed(0)}%`);

  line("[76] Compliance snapshot diff (S73)");
  const olderPack = packGen.generate({ tenantId: "t1", governance: { totalAgents: 1, deployedAgents: 1, certifiedAgents: 0, openIncidents: 1 }, auditExport: auditBundle, drRunbook: runbook, profile: profileStore.getVersion("t1", 1) });
  const newerPack = complianceArchive.latest()!;
  const postureDiff = diffCompliancePacks(olderPack, newerPack);
  line(`    posture diff: ${postureDiff.changes.length} change(s) [${postureDiff.changes.map((c) => c.field).join(", ")}]`);

  line("[77] Scheduled status recorder builds the trend (S74)");
  const recordedHistory = new PlatformStatusHistory();
  const recorderStates: Array<"down" | "degraded" | "healthy"> = ["down", "degraded", "healthy"];
  let recIdx = 0;
  let recClock = 0;
  const recScheduler = new Scheduler(() => recClock);
  recScheduler.schedule(statusRecorderJob("status-recorder", 60_000, {
    status: new PlatformStatus(),
    history: recordedHistory,
    collect: () => ({ health: { state: recorderStates[recIdx++], healthyCount: 1, totalComponents: 2 }, agents: { total: 1, deployed: 1, retired: 0 }, reviews: { pending: 0 }, drift: { agentsScanned: 1, regressions: 0 }, billing: { tenantsBilled: 1, periodTotalMinor: 10000, currency: "USD" } }),
  }));
  for (const tick of [60_000, 120_000, 180_000]) {
    recClock = tick;
    await recScheduler.tick();
  }
  line(`    recorded ${recordedHistory.count()} samples on a schedule; trend=${recordedHistory.summary().trend}`);

  line("[78] /status/history endpoint over HTTP (S75)");
  const statusHistRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    statusHistoryProvider: () => recordedHistory.summary(),
  });
  const statusHistServer = createHttpServer(statusHistRouter);
  await new Promise<void>((resolve) => statusHistServer.listen(0, resolve));
  const shAddr = statusHistServer.address();
  const shPort = typeof shAddr === "object" && shAddr ? shAddr.port : 0;
  const shHttp = await fetch(`http://localhost:${shPort}/status/history`, { headers: { authorization: "Bearer tok" } });
  const shBody = await shHttp.json() as { samples: number; trend: string };
  line(`    GET /status/history -> ${shHttp.status}; ${shBody.samples} samples, trend=${shBody.trend}`);
  await new Promise<void>((resolve) => statusHistServer.close(() => resolve()));

  line("[79] /compliance/history endpoint over HTTP (S76)");
  const compHistRouter = buildApi({
    identity, registry: new GovernedRegistry(), reviews: new ReviewQueue(new InMemoryChannel()),
    events: new EventBus({ transport: { post: async () => true } }), tokens: new Map([["tok", "api-admin"]]),
    complianceHistoryProvider: () => ({ snapshots: complianceArchive.count(), latestDiff: postureDiff }),
  });
  const compHistServer = createHttpServer(compHistRouter);
  await new Promise<void>((resolve) => compHistServer.listen(0, resolve));
  const chAddr = compHistServer.address();
  const chPort = typeof chAddr === "object" && chAddr ? chAddr.port : 0;
  const chHttp = await fetch(`http://localhost:${chPort}/compliance/history`, { headers: { authorization: "Bearer tok" } });
  const chBody = await chHttp.json() as { snapshots: number };
  line(`    GET /compliance/history -> ${chHttp.status}; ${chBody.snapshots} archived snapshot(s)`);
  await new Promise<void>((resolve) => compHistServer.close(() => resolve()));

  line("\n=== Golden Thread complete · no network used ===");
  return 0;
}
