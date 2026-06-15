# Getting Foundry IQ access — what Claude needs from you (Senthil)

**Why:** the hackathon's one mandatory requirement is integrating a Microsoft IQ layer
(Foundry IQ / Work IQ / Fabric IQ). AgentFoundry's "Foundry IQ" today is a cosmetic label
on a local knowledge base — not a real integration. To wire the **real** Foundry IQ, Claude
can write every line of code, but only YOU can create the Azure resource and authenticate.
This file is the exact, minimal set of steps + the three values to hand back.

Foundry IQ = Azure AI Foundry's **agentic knowledge retrieval**: you create a knowledge
source (your docs), and an endpoint returns cited, permission-scoped grounding chunks.

---

## What Claude needs back from you (the whole ask, up front)

Just **three values** (none are secret-secret — endpoint + project are identifiers; the
token is short-lived). Paste them when you have them:

1. `FOUNDRY_IQ_ENDPOINT` — the Foundry project/resource endpoint URL
2. `FOUNDRY_IQ_PROJECT`  — the project (or knowledge-source) ID/name
3. a **token** to call it — either a short-lived bearer token, OR confirm you'll use
   `DefaultAzureCredential` (Claude wires token acquisition; you just `az login` on the box)

> Do **not** paste a long-lived client *secret* into chat. Prefer the token or the
> credential path. The disclaimer disqualifies repos/chats that leak secrets.

---

## Step-by-step (≈15–20 min, free tier is fine)

### 0. Prerequisite
- An Azure account. Free signup: https://azure.microsoft.com/free — gives credits, enough
  for a Foundry project + a small knowledge source.

### 1. Create an Azure AI Foundry project
- Go to **https://ai.azure.com** (Azure AI Foundry portal).
- Sign in → **+ Create project** (it creates/attaches a hub + project).
- Note the **project name** and, from the project's **Overview**, its **endpoint URL**.
  → this is `FOUNDRY_IQ_ENDPOINT` + `FOUNDRY_IQ_PROJECT`.

### 2. Create a knowledge source (the "Acme KB" becomes real)
- In the project, open **Knowledge** / **Data + indexes** (Foundry IQ knowledge sources).
- **+ New** knowledge source → upload a few small docs that contain the facts the demo
  grounds on. To match the existing Golden Thread, the docs should state:
  - "Acme support hours are 9am to 5pm."
  - "Acme's refund window is 30 days."
  - (add a couple more Acme-policy lines so retrieval has real content to cite)
- Let it index. Note the knowledge-source name/ID if it's separate from the project.

### 3. Get a token to call it (pick ONE)
- **Easiest for a demo (recommended):** on the deploy box or your laptop, run
  `az login` once. Claude wires the server to use `DefaultAzureCredential`, which picks up
  that login automatically — no token pasted anywhere. Just tell Claude "using az login".
- **Or** a short-lived bearer token for quick local testing:
  `az account get-access-token --resource https://ai.azure.com` → copy the `accessToken`.
  (These expire in ~1 hour — fine for a test run, not for the deployed box.)

### 4. Hand back the three values
Paste into chat:
```
FOUNDRY_IQ_ENDPOINT = https://<your-project>.<region>.inference.ml.azure.com  (or as shown in Overview)
FOUNDRY_IQ_PROJECT  = <project or knowledge-source id>
auth                = "using az login"   (preferred)   — or a short-lived token for local test
```

---

## What Claude does the moment those arrive (S123)
1. Writes `backend/src/foundry_iq.ts` — `FoundryIqRetriever` calling your endpoint +
   `LocalSeedRetriever` honest offline fallback (so `make demo-offline` still works with no network).
2. Makes `eval.ts` grounding async → calls real retrieval instead of the hardcoded array.
3. Env-selects live vs fallback in `bin-serve.ts`; the UI toggle shows **LIVE** (green) vs
   **FALLBACK** (amber) — never claims live when it isn't.
4. Adds the remove-the-source test proving a **quantified** drop in grounded accuracy
   against the *real* service (the number a judge sees).
5. Surfaces **citations** (source doc + span) in the UI — Foundry IQ's whole point.
6. 100% coverage + tsc + tracker/traceability/KNOWN_GAPS + clean commit.

## If you do NOT have / want Azure
Claude still writes the adapter + fallback so the architecture is real, and labels it
honestly in KNOWN_GAPS as "not bound to a live IQ service." That is weaker on the mandatory
gate and the Best-Use-of-IQ prize — stated plainly so you decide with open eyes.

## Blocking question before any of this matters
**Is the submission window still open?** The brief says submissions close **June 14**; today
is **June 15**. Verify on the live site first — if it's closed, none of the above is worth
your time.
