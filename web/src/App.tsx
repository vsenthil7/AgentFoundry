import { useMemo, useState } from "react";
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
  type RegistryRecord,
  type Certification,
  type Pack,
  type AttackResult,
  type ScoreCard,
} from "./engine/index.js";
import { Card, Button, Badge, Banner, type BadgeTone } from "./ui/components.js";

type Stage = "compose" | "evaluate" | "redteam" | "score" | "approve" | "export";

const PIPELINE: Stage[] = ["compose", "evaluate", "redteam", "score", "approve", "export"];
const STAGE_LABEL: Record<Stage, string> = {
  compose: "Compose",
  evaluate: "Evaluate",
  redteam: "Red team",
  score: "Score",
  approve: "Approve",
  export: "Export",
};

export function App() {
  const [stage, setStage] = useState<Stage>("compose");
  const [grounded, setGrounded] = useState(true);
  const [groundedAccuracy, setGroundedAccuracy] = useState<number | null>(null);
  const [attacks, setAttacks] = useState<AttackResult[] | null>(null);
  const [card, setCard] = useState<ScoreCard | null>(null);
  const [approved, setApproved] = useState<boolean | null>(null);
  const [exported, setExported] = useState<boolean | null>(null);
  const [registryRecord, setRegistryRecord] = useState<RegistryRecord | null>(null);
  const [regressionBlocked, setRegressionBlocked] = useState<boolean | null>(null);
  const [certification, setCertification] = useState<Certification | null>(null);
  const [published, setPublished] = useState<Pack | null>(null);
  const [consumedScore, setConsumedScore] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const design = useMemo(() => acmeSupportBot(), []);
  const compiled = useMemo(() => compileGraph(design), [design]);
  const cases = useMemo(() => new DeterministicCaseGenerator().generate(design), [design]);
  const model = useMemo(() => new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." }), []);
  const matrix = useMemo(() => buildCoverageMatrix(), []);

  function append(msg: string) {
    setLog((l) => [...l, msg]);
  }
  function doneIndex(): number {
    return PIPELINE.indexOf(stage);
  }

  function runEvaluate() {
    const res = runEvalSuite(design, cases, model, { useGrounding: grounded });
    setGroundedAccuracy(res.groundedAccuracy);
    append(`evaluate: grounded=${grounded} grounded-accuracy=${res.groundedAccuracy.toFixed(3)}`);
    setStage("redteam");
  }

  function runRedTeam() {
    const res = runBattle(design, model, { designId: design.id });
    setAttacks(res);
    append(`redteam: ${res.filter((a) => a.passed).length}/${res.length} defended`);
    setStage("score");
  }

  function runScore() {
    const evalRun = runEvalSuite(design, cases, model, { useGrounding: grounded });
    const c = computeScoreCard({
      design,
      evalRun,
      attacks: attacks ?? [],
      repeatedPassRates: [evalRun.passRate, evalRun.passRate],
    });
    setCard(c);
    append(`score: weighted=${c.weightedScore.toFixed(3)}`);
    setStage("approve");
  }

  function decide(scoreCard: ScoreCard, decision: "approved" | "rejected") {
    const outcome = requestPromotion(design, scoreCard, { id: "reviewer@acme.test", decision });
    setApproved(outcome.state === "approved");
    append(`approve: ${outcome.state}`);
    if (outcome.state === "approved") setStage("export");
  }

  function runExport(scoreCard: ScoreCard) {
    const manifest = exportManifest(design, cases);
    const ok = roundTripIsLossless(manifest);
    setExported(ok);
    append(`export: roundTripLossless=${ok}`);
    if (!ok) return;

    // S7: register and walk the lifecycle to deployed with lineage.
    const reg = new AgentRegistry();
    reg.register(design, design.sdlc.owner);
    reg.transition(design.id, "in_review", "reviewer@acme.test");
    reg.transition(design.id, "approved", "reviewer@acme.test");
    reg.transition(design.id, "exported", "ci-bot");
    const deployed = reg.transition(design.id, "deployed", "ops");
    setRegistryRecord(deployed);
    append(`registry: ${design.id} -> deployed (${deployed.lineage.length} lineage entries)`);

    // S8: regression gate — re-run prior suite, confirm no regression.
    const baseline = attacks ?? [];
    const rerun = runBattle(design, model, { designId: design.id });
    const gate = regressionGate(baseline, rerun);
    setRegressionBlocked(gate.regressed);
    append(`regression-gate: regressed=${gate.regressed}`);

    // S9: cost governance + certification.
    const runCost = computeRunCost(1500, 2, { pricePer1kTokens: 2, pricePerToolCall: 0.5 });
    const verdict = enforceBudget({ perRunLimit: 10, totalLimit: 100 }, 0, runCost.total);
    const cert = certify({ card: scoreCard, coverage: matrix, costEfficient: verdict.state === "ok" });
    setCertification(cert);
    append(`certification: ${cert.tier} (${cert.earnedCount}/${cert.badges.length} badges) · run cost ${runCost.total}`);

    // S10: publish the certified agent as a marketplace pack, then consume it
    // and re-run from the manifest to prove interoperability.
    const mp = new Marketplace();
    const pack: Pack = {
      id: "pack-acme",
      kind: "agent_template",
      name: "Acme Support Template",
      publisher: design.sdlc.owner,
      version: design.sdlc.version,
      certificationTier: cert.tier,
      publishedAt: new Date(0).toISOString(),
      manifest,
    };
    mp.publish(pack);
    setPublished(pack);
    const consumed = mp.consume("pack-acme");
    if (consumed.kind === "agent_template") {
      const cev = runEvalSuite(consumed.manifest.agent, [...consumed.manifest.evalSuite], model, { useGrounding: true });
      const cattacks = runBattle(consumed.manifest.agent, model, { designId: consumed.manifest.agent.id }, [...consumed.manifest.redTeamSuite]);
      const ccard = computeScoreCard({
        design: consumed.manifest.agent,
        evalRun: cev,
        attacks: cattacks,
        repeatedPassRates: [cev.passRate, cev.passRate],
      });
      setConsumedScore(ccard.weightedScore);
      append(`marketplace: published ${pack.id} (${pack.certificationTier}); consumed re-score=${ccard.weightedScore.toFixed(3)}`);
    }
  }

  function toggleGrounding() {
    const next = !grounded;
    setGrounded(next);
    const res = runEvalSuite(design, cases, model, { useGrounding: next });
    setGroundedAccuracy(res.groundedAccuracy);
    append(`remove-the-source: grounding=${next} grounded-accuracy=${res.groundedAccuracy.toFixed(3)}`);
  }

  const nodeTone: Record<string, BadgeTone> = {
    model: "info",
    grounding: "success",
    guardrail: "warn",
    hitl: "brand",
    tool: "neutral",
  };

  return (
    <div className="af-console">
      <header className="af-console__head">
        <div>
          <h1 className="af-console__title">AgentFoundry</h1>
          <span className="af-console__sub" data-testid="track-tag">Agent SDLC Console</span>
        </div>
        <span className="af-console__state" data-testid="lifecycle-state">
          {design.sdlc.lifecycleState} · v{design.sdlc.version} · {design.sdlc.riskTier} risk
        </span>
      </header>

      {/* Guided stepper */}
      <ol className="af-stepper" data-testid="pipeline">
        {PIPELINE.map((s, i) => {
          const done = i < doneIndex();
          const active = s === stage;
          return (
            <li
              key={s}
              className={"af-stepper__step" + (active ? " af-stepper__step--active" : "") + (done ? " af-stepper__step--done" : "")}
              data-testid={`step-${s}`}
            >
              <span className="af-stepper__num">{done ? "✓" : i + 1}</span>
              <span className="af-stepper__label">{STAGE_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>

      <div className="af-console__grid">
        <Card title={`Canvas · ${design.name}`} data-testid="canvas-panel">
          <div className="af-console__row">
            <span>Graph</span>
            <Badge tone={compiled.valid ? "success" : "danger"} data-testid="graph-valid">
              {compiled.valid ? "VALID ✓" : "INVALID ✗"}
            </Badge>
          </div>
          <div className="af-console__nodes">
            {design.nodes.map((n) => (
              <div className="af-console__node" key={n.id} data-testid={`node-${n.id}`}>
                <Badge tone={nodeTone[n.type] ?? "neutral"}>{n.type}</Badge>
                <span>{n.label}</span>
              </div>
            ))}
          </div>
          <div className="af-console__actions">
            <Button variant="primary" data-testid="btn-evaluate" disabled={!compiled.valid} onClick={runEvaluate}>
              Auto-generate evals &amp; run
            </Button>
            <Button variant="secondary" data-testid="btn-toggle-grounding" onClick={toggleGrounding}>
              Foundry IQ: {grounded ? "ON" : "OFF"}
            </Button>
          </div>
        </Card>

        <Card title={`Evaluation · ${cases.length} cases`} data-testid="eval-panel">
          <div className="af-console__cases">
            {cases.map((c) => (
              <div className="af-console__case" key={c.id} data-testid={`case-${c.id}`}>
                <Badge tone="neutral">{c.kind}</Badge>
                <span>{c.input}</span>
              </div>
            ))}
          </div>
          {groundedAccuracy !== null && (
            <Banner tone={groundedAccuracy >= 0.5 ? "success" : "danger"} data-testid="grounded-accuracy" className="af-console__banner">
              grounded-accuracy: {groundedAccuracy.toFixed(3)}
            </Banner>
          )}
        </Card>

        <Card title="Battle Mode · Red Team" data-testid="redteam-panel">
          <div className="af-console__row">
            <span>Coverage matrix fully-mapped</span>
            <Badge tone={matrix.fullyMapped ? "success" : "danger"} data-testid="coverage-matrix">
              {matrix.fullyMapped ? "YES ✓" : "NO ✗"}
            </Badge>
          </div>
          {stage === "redteam" && (
            <div className="af-console__actions">
              <Button variant="primary" data-testid="btn-redteam" onClick={runRedTeam}>Fire attack battery</Button>
            </div>
          )}
          <div className="af-console__attacks">
            {attacks?.map((a) => (
              <div className="af-console__attack" key={a.attackId} data-testid={`attack-${a.attackId}`}>
                <Badge tone={a.passed ? "success" : "danger"} data-testid={`attack-status-${a.attackId}`}>
                  {a.passed ? "DEFENDED" : "LEAKED"}
                </Badge>
                <span>{a.attackId}</span>
                <span className="af-console__ids">
                  {[a.mapping.owasp, a.mapping.atlas, a.mapping.nist].filter(Boolean).join(" / ")}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Safety Radar · Score Provenance" data-testid="score-panel">
          {stage === "score" && (
            <div className="af-console__actions">
              <Button variant="primary" data-testid="btn-score" onClick={runScore}>Compute deterministic score</Button>
            </div>
          )}
          {card && (
            <>
              <div className={"af-console__score " + (meetsPromotionThreshold(card) ? "af-console__score--pass" : "af-console__score--fail")} data-testid="weighted-score">
                {card.weightedScore.toFixed(3)}
              </div>
              <div className="af-console__metrics">
                <div className="af-console__metric"><span>grounded-accuracy</span><span>{card.groundedAccuracy.toFixed(3)}</span></div>
                <div className="af-console__metric"><span>safety pass rate</span><span>{card.safetyPassRate.toFixed(3)}</span></div>
                <div className="af-console__metric"><span>consistency</span><span>{card.consistencyScore.toFixed(3)}</span></div>
                <div className="af-console__metric"><span>HITL coverage</span><span>{card.hitlCoverage.toFixed(3)}</span></div>
                <div className="af-console__metric"><span>tool-scope risk</span><span>{card.toolScopeRisk.toFixed(3)}</span></div>
              </div>
            </>
          )}
        </Card>

        <Card title="Human Promotion Gate" data-testid="promotion-panel">
          {stage === "approve" && card && (
            <div className="af-console__actions">
              <Button variant="primary" data-testid="btn-approve" onClick={() => decide(card, "approved")}>Approve promotion</Button>
              <Button variant="danger" data-testid="btn-reject" onClick={() => decide(card, "rejected")}>Reject</Button>
            </div>
          )}
          {approved !== null && (
            <Banner tone={approved ? "success" : "danger"} data-testid="approval-result" className="af-console__banner">
              {approved ? "APPROVED by reviewer@acme.test" : "REJECTED / blocked"}
            </Banner>
          )}
        </Card>

        <Card title="Export · Foundry Manifest" data-testid="export-panel">
          {stage === "export" && card && (
            <div className="af-console__actions">
              <Button variant="primary" data-testid="btn-export" onClick={() => runExport(card)}>Export + verify round-trip</Button>
            </div>
          )}
          {exported !== null && (
            <Banner tone={exported ? "success" : "danger"} data-testid="export-result" className="af-console__banner">
              round-trip fidelity: {exported ? "LOSSLESS ✓ — CI ready" : "FAILED ✗"}
            </Banner>
          )}
        </Card>

        <Card title="Registry · Lifecycle · Regression Gate" data-testid="registry-panel">
          {registryRecord === null ? (
            <p className="af-console__hint">(agent registers after a green export)</p>
          ) : (
            <>
              <div className="af-console__metrics">
                <div className="af-console__metric"><span>state</span><span data-testid="registry-state">{registryRecord.state}</span></div>
                <div className="af-console__metric"><span>version</span><span>{registryRecord.currentVersion}</span></div>
                <div className="af-console__metric"><span>owner</span><span>{registryRecord.owner}</span></div>
                <div className="af-console__metric"><span>risk tier</span><span>{registryRecord.riskTier}</span></div>
                <div className="af-console__metric"><span>cost center</span><span>{registryRecord.costCenter}</span></div>
              </div>
              <h3 className="af-console__h3">Lineage</h3>
              <div className="af-console__attacks">
                {registryRecord.lineage.map((entry, i) => (
                  <div className="af-console__attack" key={i} data-testid={`lineage-${i}`}>
                    <span>{entry.fromState}</span><span>→</span><span>{entry.toState}</span>
                    <span className="af-console__ids">{entry.actor}</span>
                  </div>
                ))}
              </div>
              {regressionBlocked !== null && (
                <Banner tone={regressionBlocked ? "danger" : "success"} data-testid="regression-result" className="af-console__banner">
                  regression gate: {regressionBlocked ? "BLOCKED — prior attack regressed" : "CLEAR ✓"}
                </Banner>
              )}
              {certification && (
                <>
                  <h3 className="af-console__h3">Certification</h3>
                  <div className={"af-console__score " + (certification.tier === "none" ? "af-console__score--fail" : "af-console__score--pass")} data-testid="cert-tier">
                    {certification.tier.toUpperCase()}
                  </div>
                  <div className="af-console__attacks">
                    {certification.badges.map((b) => (
                      <div className="af-console__attack" key={b.id} data-testid={`badge-${b.id}`}>
                        <Badge tone={b.earned ? "success" : "neutral"} data-testid={`badge-status-${b.id}`}>{b.earned ? "EARNED" : "—"}</Badge>
                        <span>{b.label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {published && (
                <>
                  <h3 className="af-console__h3">Marketplace</h3>
                  <div className="af-console__metrics">
                    <div className="af-console__metric"><span>published pack</span><span data-testid="pack-id">{published.id}</span></div>
                    <div className="af-console__metric"><span>trust signal</span><span>{published.certificationTier}</span></div>
                  </div>
                  {consumedScore !== null && (
                    <Banner tone="success" data-testid="consumed-score" className="af-console__banner">
                      consumed &amp; re-ran from manifest · score {consumedScore.toFixed(3)} (interoperable ✓)
                    </Banner>
                  )}
                </>
              )}
            </>
          )}
        </Card>
      </div>

      <Card title="Audit Log" data-testid="log-panel" className="af-console__logcard">
        <pre className="af-console__log" data-testid="audit-log">
          {log.length === 0 ? "(no actions yet)" : log.join("\n")}
        </pre>
      </Card>
    </div>
  );
}
