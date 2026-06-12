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

type Stage =
  | "compose"
  | "evaluate"
  | "redteam"
  | "score"
  | "approve"
  | "export";

const PIPELINE: Stage[] = [
  "compose",
  "evaluate",
  "redteam",
  "score",
  "approve",
  "export",
];

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
  const cases = useMemo(
    () => new DeterministicCaseGenerator().generate(design),
    [design],
  );
  const model = useMemo(
    () => new StubModel(acmeGroundedModelTable(), { fallback: "I don't know." }),
    [],
  );
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
    append(
      `evaluate: grounded=${grounded} grounded-accuracy=${res.groundedAccuracy.toFixed(3)}`,
    );
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

  function decide(decision: "approved" | "rejected") {
    if (!card) return;
    const outcome = requestPromotion(design, card, {
      id: "reviewer@acme.test",
      decision,
    });
    setApproved(outcome.state === "approved");
    append(`approve: ${outcome.state}`);
    if (outcome.state === "approved") setStage("export");
  }

  function runExport() {
    const manifest = exportManifest(design, cases);
    const ok = roundTripIsLossless(manifest);
    setExported(ok);
    append(`export: roundTripLossless=${ok}`);
    if (ok) {
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
      if (card) {
        const runCost = computeRunCost(1500, 2, {
          pricePer1kTokens: 2,
          pricePerToolCall: 0.5,
        });
        const verdict = enforceBudget(
          { perRunLimit: 10, totalLimit: 100 },
          0,
          runCost.total,
        );
        const cert = certify({
          card,
          coverage: matrix,
          costEfficient: verdict.state === "ok",
        });
        setCertification(cert);
        append(
          `certification: ${cert.tier} (${cert.earnedCount}/${cert.badges.length} badges) · run cost ${runCost.total}`,
        );

        // S10: publish the certified agent as a marketplace pack, then consume
        // it and re-run from the manifest to prove interoperability.
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
          const cev = runEvalSuite(
            consumed.manifest.agent,
            [...consumed.manifest.evalSuite],
            model,
            { useGrounding: true },
          );
          const cattacks = runBattle(
            consumed.manifest.agent,
            model,
            { designId: consumed.manifest.agent.id },
            [...consumed.manifest.redTeamSuite],
          );
          const ccard = computeScoreCard({
            design: consumed.manifest.agent,
            evalRun: cev,
            attacks: cattacks,
            repeatedPassRates: [cev.passRate, cev.passRate],
          });
          setConsumedScore(ccard.weightedScore);
          append(
            `marketplace: published ${pack.id} (${pack.certificationTier}); consumed re-score=${ccard.weightedScore.toFixed(3)}`,
          );
        }
      }
    }
  }

  function toggleGrounding() {
    const next = !grounded;
    setGrounded(next);
    // Show measured remove-the-source effect immediately.
    const res = runEvalSuite(design, cases, model, { useGrounding: next });
    setGroundedAccuracy(res.groundedAccuracy);
    append(
      `remove-the-source: grounding=${next} grounded-accuracy=${res.groundedAccuracy.toFixed(3)}`,
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1>AgentFoundry</h1>
        <span className="tag" data-testid="track-tag">
          AGENT SDLC CONSOLE
        </span>
        <span className="state" data-testid="lifecycle-state">
          state: {design.sdlc.lifecycleState} · v{design.sdlc.version} ·{" "}
          {design.sdlc.riskTier} risk
        </span>
      </header>

      <div className="pipeline" data-testid="pipeline">
        {PIPELINE.map((s, i) => (
          <span
            key={s}
            className={`step ${s === stage ? "active" : ""} ${i < doneIndex() ? "done" : ""}`}
            data-testid={`step-${s}`}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>

      <div className="grid">
        <section className="panel" data-testid="canvas-panel">
          <h2>Canvas · {design.name}</h2>
          <div data-testid="graph-valid">
            graph: {compiled.valid ? "VALID ✓" : "INVALID ✗"}
          </div>
          {design.nodes.map((n) => (
            <div className={`node ${n.type}`} key={n.id} data-testid={`node-${n.id}`}>
              [{n.type}] {n.label}
            </div>
          ))}
          <div className="controls" style={{ marginTop: 16 }}>
            <button
              className="primary"
              data-testid="btn-evaluate"
              disabled={!compiled.valid}
              onClick={runEvaluate}
            >
              ▶ Auto-generate evals & run
            </button>
            <button data-testid="btn-toggle-grounding" onClick={toggleGrounding}>
              Foundry IQ: {grounded ? "ON" : "OFF"}
            </button>
          </div>
        </section>

        <section className="panel" data-testid="eval-panel">
          <h2>Evaluation · {cases.length} cases</h2>
          {cases.map((c) => (
            <div className="metric" key={c.id} data-testid={`case-${c.id}`}>
              <span>
                [{c.kind}] {c.input}
              </span>
            </div>
          ))}
          {groundedAccuracy !== null && (
            <div
              className={`banner ${groundedAccuracy >= 0.5 ? "pass" : "fail"}`}
              data-testid="grounded-accuracy"
            >
              grounded-accuracy: {groundedAccuracy.toFixed(3)}
            </div>
          )}
        </section>

        <section className="panel" data-testid="redteam-panel">
          <h2>Battle Mode · Red Team</h2>
          <div data-testid="coverage-matrix">
            coverage matrix fully-mapped: {matrix.fullyMapped ? "YES ✓" : "NO ✗"}
          </div>
          {stage === "redteam" && (
            <button
              className="primary"
              data-testid="btn-redteam"
              onClick={runRedTeam}
              style={{ marginTop: 12 }}
            >
              ▶ Fire attack battery
            </button>
          )}
          {attacks?.map((a) => (
            <div className="attack" key={a.attackId} data-testid={`attack-${a.attackId}`}>
              <span
                className={`badge ${a.passed ? "defended" : "leaked"}`}
                data-testid={`attack-status-${a.attackId}`}
              >
                {a.passed ? "DEFENDED" : "LEAKED"}
              </span>
              <span>{a.attackId}</span>
              <span className="ids">
                {[a.mapping.owasp, a.mapping.atlas, a.mapping.nist]
                  .filter(Boolean)
                  .join(" / ")}
              </span>
            </div>
          ))}
        </section>

        <section className="panel" data-testid="score-panel">
          <h2>Safety Radar · Score Provenance</h2>
          {stage === "score" && (
            <button className="primary" data-testid="btn-score" onClick={runScore}>
              ▶ Compute deterministic score
            </button>
          )}
          {card && (
            <>
              <div
                className={`score-big ${meetsPromotionThreshold(card) ? "pass" : "fail"}`}
                data-testid="weighted-score"
              >
                {card.weightedScore.toFixed(3)}
              </div>
              <div className="metric">
                <span>grounded-accuracy</span>
                <span className="v">{card.groundedAccuracy.toFixed(3)}</span>
              </div>
              <div className="metric">
                <span>safety pass rate</span>
                <span className="v">{card.safetyPassRate.toFixed(3)}</span>
              </div>
              <div className="metric">
                <span>consistency</span>
                <span className="v">{card.consistencyScore.toFixed(3)}</span>
              </div>
              <div className="metric">
                <span>HITL coverage</span>
                <span className="v">{card.hitlCoverage.toFixed(3)}</span>
              </div>
              <div className="metric">
                <span>tool-scope risk</span>
                <span className="v">{card.toolScopeRisk.toFixed(3)}</span>
              </div>
            </>
          )}
        </section>

        <section className="panel" data-testid="promotion-panel">
          <h2>Human Promotion Gate</h2>
          {stage === "approve" && card && (
            <div className="controls">
              <button
                className="primary"
                data-testid="btn-approve"
                onClick={() => decide("approved")}
              >
                ✓ Approve promotion
              </button>
              <button
                className="danger"
                data-testid="btn-reject"
                onClick={() => decide("rejected")}
              >
                ✗ Reject
              </button>
            </div>
          )}
          {approved !== null && (
            <div
              className={`banner ${approved ? "pass" : "fail"}`}
              data-testid="approval-result"
            >
              {approved ? "APPROVED by reviewer@acme.test" : "REJECTED / blocked"}
            </div>
          )}
        </section>

        <section className="panel" data-testid="export-panel">
          <h2>Export · Foundry Manifest</h2>
          {stage === "export" && (
            <button className="primary" data-testid="btn-export" onClick={runExport}>
              ▶ Export + verify round-trip
            </button>
          )}
          {exported !== null && (
            <div
              className={`banner ${exported ? "pass" : "fail"}`}
              data-testid="export-result"
            >
              round-trip fidelity: {exported ? "LOSSLESS ✓ — CI ready" : "FAILED ✗"}
            </div>
          )}
        </section>

        <section className="panel" data-testid="registry-panel">
          <h2>Registry · Lifecycle · Regression Gate</h2>
          {registryRecord === null ? (
            <div className="log">(agent registers after a green export)</div>
          ) : (
            <>
              <div className="metric">
                <span>state</span>
                <span className="v good" data-testid="registry-state">
                  {registryRecord.state}
                </span>
              </div>
              <div className="metric">
                <span>version</span>
                <span className="v">{registryRecord.currentVersion}</span>
              </div>
              <div className="metric">
                <span>owner</span>
                <span className="v">{registryRecord.owner}</span>
              </div>
              <div className="metric">
                <span>risk tier</span>
                <span className="v">{registryRecord.riskTier}</span>
              </div>
              <div className="metric">
                <span>cost center</span>
                <span className="v">{registryRecord.costCenter}</span>
              </div>
              <h2 style={{ marginTop: 12 }}>Lineage</h2>
              {registryRecord.lineage.map((entry, i) => (
                <div className="attack" key={i} data-testid={`lineage-${i}`}>
                  <span>{entry.fromState}</span>
                  <span>→</span>
                  <span>{entry.toState}</span>
                  <span className="ids">{entry.actor}</span>
                </div>
              ))}
              {regressionBlocked !== null && (
                <div
                  className={`banner ${regressionBlocked ? "fail" : "pass"}`}
                  data-testid="regression-result"
                >
                  regression gate:{" "}
                  {regressionBlocked ? "BLOCKED — prior attack regressed" : "CLEAR ✓"}
                </div>
              )}
              {certification && (
                <>
                  <h2 style={{ marginTop: 12 }}>Certification</h2>
                  <div
                    className={`score-big ${certification.tier === "none" ? "fail" : "pass"}`}
                    data-testid="cert-tier"
                  >
                    {certification.tier.toUpperCase()}
                  </div>
                  {certification.badges.map((b) => (
                    <div className="attack" key={b.id} data-testid={`badge-${b.id}`}>
                      <span
                        className={`badge ${b.earned ? "defended" : "leaked"}`}
                        data-testid={`badge-status-${b.id}`}
                      >
                        {b.earned ? "EARNED" : "—"}
                      </span>
                      <span>{b.label}</span>
                    </div>
                  ))}
                </>
              )}
              {published && (
                <>
                  <h2 style={{ marginTop: 12 }}>Marketplace</h2>
                  <div className="metric">
                    <span>published pack</span>
                    <span className="v good" data-testid="pack-id">
                      {published.id}
                    </span>
                  </div>
                  <div className="metric">
                    <span>trust signal</span>
                    <span className="v">{published.certificationTier}</span>
                  </div>
                  {consumedScore !== null && (
                    <div className="banner pass" data-testid="consumed-score">
                      consumed &amp; re-ran from manifest · score{" "}
                      {consumedScore.toFixed(3)} (interoperable ✓)
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }} data-testid="log-panel">
        <h2>Audit Log</h2>
        <div className="log" data-testid="audit-log">
          {log.length === 0 ? "(no actions yet)" : log.join("\n")}
        </div>
      </section>
    </div>
  );
}
