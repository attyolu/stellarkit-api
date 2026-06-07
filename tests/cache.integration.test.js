const request = require("supertest");
const app = require("../src/index");
const cacheService = require("../src/services/cache");

describe("Cache Integration", () => {
  beforeEach(() => {
    cacheService.flush();
  });

  describe("GET /network-status", () => {
    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get("/network-status");
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("should return X-Cache: HIT on second request", async () => {
      await request(app).get("/network-status"); // First request to seed cache
      const res = await request(app).get("/network-status");
      expect(res.headers["x-cache"]).toBe("HIT");
    });

    it("should return X-Cache: MISS when ?fresh=true is used", async () => {
      await request(app).get("/network-status"); // Seed cache
      const res = await request(app).get("/network-status?fresh=true");
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  describe("GET /fee-estimate", () => {
    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get("/fee-estimate");
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("should return X-Cache: HIT on second request", async () => {
      await request(app).get("/fee-estimate"); // Seed cache
      const res = await request(app).get("/fee-estimate");
      expect(res.headers["x-cache"]).toBe("HIT");
    });
  });

  describe("GET /asset/:code/:issuer", () => {
    const code = "USDC";
    const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

    it("should return X-Cache: MISS on first request", async () => {
      const res = await request(app).get(`/asset/${code}/${issuer}`);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("should return X-Cache: HIT on second request", async () => {
      await request(app).get(`/asset/${code}/${issuer}`); // Seed cache
      const res = await request(app).get(`/asset/${code}/${issuer}`);
      expect(res.headers["x-cache"]).toBe("HIT");
    });
  });
});
