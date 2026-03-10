# Daydreaming Discovery Loop (DDL)

An automated insight discovery pipeline that finds surprising connections between concepts across different domains. It pairs anti-correlated concepts, generates puzzles from their tension, scores them using Simplicity Theory, produces candidate insights, evaluates them through multiple lenses, and surfaces the best ones for expert review in a web dashboard.

## How It Works

1. **Concept Pairing** — Samples pairs of concepts with low cosine similarity (anti-correlated) from a ChromaDB vector store
2. **Puzzle Generation** — Asks Claude to identify genuine puzzles arising from the tension between each pair
3. **Simplicity Theory Scoring** — Scores each puzzle's unexpectedness using zstd compression + Claude's generation likelihood estimate
4. **Insight Generation** — For puzzles that pass the adaptive ST threshold, generates candidate insights with enrichment from related concepts
5. **Evaluation** — Routes insights through fertility, adversarial critique, unification, novelty, and grounding checks
6. **Expert Review** — Candidates that pass the composite threshold appear in the dashboard for human approval/rejection

## Prerequisites

- **Node.js** (v18+)
- **ChromaDB** running locally
- **Anthropic API key**

## Setup

### 1. Install ChromaDB

```bash
pip install chromadb
```

Or with Docker:

```bash
docker pull chromadb/chroma
docker run -p 8000:8000 chromadb/chroma
```

### 2. Start ChromaDB

If installed via pip, run:

```bash
chroma run --host localhost --port 8000
```

If using Docker, it's already running from the `docker run` command above.

Verify it's up by visiting `http://localhost:8000/api/v1/heartbeat` in your browser — you should see a response with a nanosecond timestamp.

### 3. Clone and install dependencies

```bash
git clone <your-repo-url>
cd DDL
npm install
```

### 4. Configure environment

Copy the template and fill in your keys:

```bash
cp .env.template .env
```

Edit `.env`:

```env
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Model (default: claude-opus-4-6-20250219)
DDL_MODEL_ID=claude-opus-4-6-20250219

# Optional: Semantic Scholar API key (for novelty search, basic search works without it)
SEMANTIC_SCHOLAR_API_KEY=

# ChromaDB connection (defaults shown)
CHROMA_HOST=localhost
CHROMA_PORT=8000
```

### 5. Start the dashboard

```bash
npm start
```

Open `http://localhost:3000` in your browser.

## Usage

1. **Add concepts** — Go to the Concepts tab and add at least 2 concepts via text, URL, or document upload
2. **Set batch size** — Adjust the batch size in the header (default: 5 pairs per run)
3. **Run the pipeline** — Click "Run Pipeline" and watch the status bar for progress
4. **Review candidates** — Switch to the Pending tab to see insights that passed evaluation. Approve, reject (with reason), flag for investigation, or refine each one

## Pipeline Configuration

These can be set in `.env` to tune the pipeline:

| Variable | Default | Description |
|---|---|---|
| `DDL_BATCH_SIZE` | `5` | Concept pairs per pipeline run (also adjustable in the UI) |
| `DDL_ANTI_CORRELATION_WINDOW` | `0.2` | Sample from bottom N% of similarity |
| `DDL_ST_THRESHOLD_PERCENTILE` | `0.95` | Adaptive ST threshold (95th percentile) |
| `DDL_ST_WINDOW_SIZE` | `50` | Rolling window size for threshold |
| `DDL_FERTILITY_THRESHOLD` | `4` | Min fertility score (1-10) |
| `DDL_RESILIENCE_THRESHOLD` | `4` | Min adversarial resilience (1-10) |
| `DDL_COMPOSITE_THRESHOLD` | `5.0` | Min composite score to surface for review |
| `DDL_WEIGHT_FERTILITY` | `0.35` | Composite weight for fertility |
| `DDL_WEIGHT_RESILIENCE` | `0.35` | Composite weight for resilience |
| `DDL_WEIGHT_UNIFICATION` | `0.30` | Composite weight for unification |
| `DDL_PORT` | `3000` | Dashboard server port |

## Project Structure

```
DDL/
  main.ts                      Orchestrator — wires modules, starts server
  src/
    shared/types.ts            Shared type definitions (contract file)
    data/                      Vector store, chunking, embedding, sampling
    pipeline/                  Puzzle generation, insight generation, ST scoring
    evaluation/                Multi-stage insight evaluation
    dashboard/
      server.ts                Express server
      routes.ts                API routes + pipeline trigger
      reviewStore.ts           In-memory candidate/decision store
      logger.ts                JSON-lines pipeline logger
      views/index.html         Single-page review dashboard
  logs/
    pipeline.jsonl             Pipeline execution logs
```
