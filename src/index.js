require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const hpp = require("hpp");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");

const { setupWebSocket } = require("./websocket");
const { server } = require("./config/stellar");
const { networkStatusCache, feeEstimateCache } = require("./utils/cache");

const rateLimiter = require("./middleware/rateLimiter");
const contentTypeValidator = require("./middleware/contentTypeValidator");
const errorHandler = require("./middleware/errorHandler");
const requestIdMiddleware = require("./middleware/requestId");

const networkStatusRouter = require("./routes/networkStatus");
const feeEstimateRouter = require("./routes/feeEstimate");
const accountRouter = require("./routes/account");
const transactionsRouter = require("./routes/transactions");
const assetRouter = require("./routes/asset");
const streamRouter = require("./routes/stream");
const utilsRouter = require("./routes/utils");

const app = express();
const PORT = process.env.PORT || 3000;

async function warmNetworkStatusCache({ logger = console, horizonServer = server } = {}) {
  const ledger = await horizonServer.ledgers().order("desc").limit(1).call();
  const latest = ledger.records[0];

  const data = {
    network: process.env.STELLAR_NETWORK || "testnet",
    horizonUrl: require("./config/stellar").horizonUrl,
    latestLedger: {
      sequence: latest.sequence,
      closedAt: latest.closed_at,
      transactionCount: latest.successful_transaction_count,
      operationCount: latest.operation_count,
      totalCoins: latest.total_coins,
      feePool: latest.fee_pool,
    },
    fees: {
      baseFeeInStroops: latest.base_fee_in_stroops,
      baseFeeInXLM: (latest.base_fee_in_stroops / 1e7).toFixed(7),
      basereserveInStroops: latest.base_reserve_in_stroops,
      baseReserveInXLM: (latest.base_reserve_in_stroops / 1e7).toFixed(7),
    },
    protocol: {
      version: latest.protocol_version,
    },
  };

  networkStatusCache.set("network-status", data);
  logger.log("[CACHE WARM] /network-status");
}

async function warmFeeEstimateCache({ logger = console, horizonServer = server } = {}) {
  const feeStats = await horizonServer.feeStats();
  const operations = 1;

  const base = parseInt(feeStats.fee_charged.p10);
  const recommended = parseInt(feeStats.fee_charged.p50);
  const priority = parseInt(feeStats.fee_charged.p95);

  const data = {
    note: `Fee estimates for a transaction with ${operations} operation(s). Fees are in stroops (1 XLM = 10,000,000 stroops).`,
    operationCount: operations,
    perOperation: {
      economy: {
        stroops: parseInt(feeStats.fee_charged.min),
        xlm: (parseInt(feeStats.fee_charged.min) / 1e7).toFixed(7),
        description: "Minimum — may be slow during congestion",
      },
      standard: {
        stroops: recommended,
        xlm: (recommended / 1e7).toFixed(7),
        description: "Recommended for most transactions",
      },
      priority: {
        stroops: priority,
        xlm: (priority / 1e7).toFixed(7),
        description: "Fast inclusion even during high network load",
      },
    },
    totalFee: {
      economy: {
        stroops: parseInt(feeStats.fee_charged.min) * operations,
        xlm: ((parseInt(feeStats.fee_charged.min) * operations) / 1e7).toFixed(7),
      },
      standard: {
        stroops: recommended * operations,
        xlm: ((recommended * operations) / 1e7).toFixed(7),
      },
      priority: {
        stroops: priority * operations,
        xlm: ((priority * operations) / 1e7).toFixed(7),
      },
    },
    networkStats: {
      lastLedgerBaseFee: feeStats.last_ledger_base_fee,
      ledgerCapacityUsage: feeStats.ledger_capacity_usage,
      maxFeeCharged: feeStats.fee_charged.max,
      p10: feeStats.fee_charged.p10,
      p50: feeStats.fee_charged.p50,
      p95: feeStats.fee_charged.p95,
      p99: feeStats.fee_charged.p99,
    },
  };

  feeEstimateCache.set("fee-estimate:1", data);
  logger.log("[CACHE WARM] /fee-estimate");
}

async function warmStartupCaches({ logger = console, horizonServer = server } = {}) {
  const warmers = [
    warmNetworkStatusCache({ logger, horizonServer }),
    warmFeeEstimateCache({ logger, horizonServer }),
  ];

  const results = await Promise.allSettled(warmers);
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const endpoint = index === 0 ? "/network-status" : "/fee-estimate";
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      logger.error(`[CACHE WARM] failed ${endpoint}: ${reason}`);
    }
  });
}

// ── Security & Parsing ──────────────────────────────────────────────────────
app.use(helmet());
app.use(compression({ threshold: 0 }));
app.use(cors());
app.use(requestIdMiddleware);
app.use(contentTypeValidator);
app.use(express.json());
app.use(hpp({ whitelist: ["limit", "order", "cursor", "operations"] }));
app.use(
  morgan(function (tokens, req, res) {
    const requestId = req.requestId || "-";
    return [
      `[${requestId}]`,
      tokens.method(req, res),
      tokens.url(req, res),
      tokens.status(req, res),
      tokens.res(req, res, "content-length"),
      "-",
      tokens["response-time"](req, res),
      "ms",
    ].join(" ");
  })
);

// ── Rate Limiting ───────────────────────────────────────────────────────────
app.use(rateLimiter);

// ── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      service: "StellarKit API",
      version: require("../package.json").version,
      timestamp: new Date().toISOString(),
      network: process.env.STELLAR_NETWORK || "testnet",
    },
  });
});

// ── API Routes ───────────────────────────────────────────────────────────────
app.use("/network-status", networkStatusRouter);
app.use("/fee-estimate", feeEstimateRouter);
app.use("/account", accountRouter);
app.use("/transactions", transactionsRouter);
app.use("/asset", assetRouter);
app.use("/stream", streamRouter);
app.use("/utils", utilsRouter);

// ── Root ─────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    success: true,
    data: {
      name: "StellarKit API",
      description:
        "A developer utility API for the Stellar blockchain. Fee estimation, account info, transactions, network status, and asset metadata.",
      version: require("../package.json").version,
      network: process.env.STELLAR_NETWORK || "testnet",
      endpoints: [
        { method: "GET", path: "/health",                           description: "Service health check" },
        { method: "GET", path: "/network-status",                   description: "Latest ledger, fees, and protocol info" },
        { method: "GET", path: "/fee-estimate",                     description: "Fee tiers for transaction submission" },
        { method: "GET", path: "/fee-estimate?operations=N",        description: "Fee estimate for N operations" },
        { method: "GET", path: "/account/:id",                      description: "Account details, balances, signers" },
        { method: "GET", path: "/account/:id/balances",             description: "XLM and asset balances for an account" },
        { method: "GET", path: "/transactions/:id",                 description: "Transaction history for an account" },
        { method: "GET", path: "/transactions/:id/operations",      description: "Operation history for an account" },
        { method: "GET", path: "/asset/:code/:issuer",              description: "Asset metadata and statistics" },
        { method: "GET", path: "/asset/:code/:issuer/holders",      description: "Paginated accounts holding an asset" },
        { method: "GET", path: "/asset/search?code=:code",          description: "Search assets by code across all issuers" },
        { method: "GET", path: "/utils/friendbot/:accountId",       description: "Fund a testnet account via Friendbot (testnet only)" },
        { method: "WS",  path: "/stream/ledgers",                  description: "Real-time stream of live Stellar ledger updates" },
      ],
      docs: "https://github.com/stellarkit-lab-devtools/stellarkit-api#readme",
    },
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      type: "NotFound",
      message: `Route ${req.method} ${req.path} not found. Visit / for available endpoints.`,
    },
  });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
function startServer({ appInstance = app, port = PORT, logger = console, setupWebSocketHook = setupWebSocket } = {}) {
  const httpServer = appInstance.listen(port, () => {
    logger.log(`\n🚀 StellarKit API running on port ${port}`);
    logger.log(`🌐 Network : ${process.env.STELLAR_NETWORK || "testnet"}`);
    logger.log(`📖 Docs    : http://localhost:${port}/\n`);

    warmStartupCaches({ logger }).catch((err) => {
      logger.error(`[CACHE WARM] startup warmup failed: ${err.message}`);
    });
  });

  setupWebSocketHook(httpServer);
  return httpServer;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer;
