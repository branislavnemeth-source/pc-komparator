import type { Express } from "express";
import type { Server } from "http";
import axios from "axios";
import * as cheerio from "cheerio";
import { storage } from "./storage";
import type { InsertComputer } from "@shared/schema";

function extractEshopName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    return hostname.split(".")[0].toUpperCase();
  } catch {
    return "Neznámy";
  }
}

function parsePrice(str: string): { value: number | null; currency: string } {
  if (!str) return { value: null, currency: "€" };
  const cleaned = str.replace(/\s/g, "").replace(",", ".");
  const euroMatch = cleaned.match(/([\d.]+)\s*€/) || cleaned.match(/€\s*([\d.]+)/);
  const czk = cleaned.match(/([\d.]+)\s*Kč/) || cleaned.match(/Kč\s*([\d.]+)/);
  if (euroMatch) return { value: parseFloat(euroMatch[1]), currency: "€" };
  if (czk) return { value: parseFloat(czk[1]), currency: "Kč" };
  const num = cleaned.match(/([\d]+[.,]?\d*)/);
  if (num) return { value: parseFloat(num[1].replace(",", ".")), currency: "€" };
  return { value: null, currency: "€" };
}

async function fetchPage(url: string): Promise<string> {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  ];

  let lastErr: any = null;
  for (const ua of userAgents) {
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": ua,
          "Accept-Language": "sk-SK,sk;q=0.9,cs;q=0.8,en-US;q=0.7,en;q=0.6",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Upgrade-Insecure-Requests": "1",
          "Connection": "keep-alive",
          Referer: "https://www.google.com/",
        },
        timeout: 25000,
        maxRedirects: 5,
      });
      return response.data as string;
    } catch (err: any) {
      lastErr = err;
      if (err.response?.status === 403 || err.response?.status === 429 || err.response?.status === 503) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Všetky pokusy zlyhali");
}

async function scrapeComputer(url: string): Promise<InsertComputer> {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe").remove();

  // ---- NAME ----
  const nameCandidates = [
    $('[itemprop="name"]').first().text(),
    $("h1.product-name, h1.nazov, h1.title, h1.produktNazev").first().text(),
    $("h1").first().text(),
    $('[class*="product-name"]').first().text(),
    $('[class*="product-title"]').first().text(),
    $("title").text().split("|")[0].split("-")[0],
  ];
  const name = nameCandidates.find((t) => t.trim().length > 3)?.trim() || "Neznámy produkt";

  // ---- PRICE ----
  // Try JSON-LD first (most reliable)
  let jsonLdPrice = "";
  let jsonLdCurrency = "";
  let jsonLdName = "";
  let jsonLdImage = "";
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html() || "{}";
      const parsed = JSON.parse(raw);
      const data = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!jsonLdName && data.name) jsonLdName = data.name;
      if (!jsonLdImage && data.image) {
        jsonLdImage = Array.isArray(data.image) ? data.image[0] : String(data.image);
      }
      if (!jsonLdPrice && data.offers?.price) {
        jsonLdPrice = String(data.offers.price);
        jsonLdCurrency = data.offers.priceCurrency || "EUR";
      }
      if (!jsonLdPrice && data.offers?.[0]?.price) {
        jsonLdPrice = String(data.offers[0].price);
        jsonLdCurrency = data.offers[0].priceCurrency || "EUR";
      }
    } catch {}
  });

  const priceCandidates = [
    jsonLdPrice ? jsonLdPrice + (jsonLdCurrency === "CZK" ? " Kč" : " €") : "",
    $('[itemprop="price"]').attr("content") || "",
    $('[itemprop="price"]').first().text(),
    $('[class*="price-box"] .price').first().text(),
    $('[class*="current-price"]').first().text(),
    $('[class*="price--main"]').first().text(),
    $('[class*="cena"] .price').first().text(),
    $('[id*="price"]').first().text(),
    $('[class*="price"]').first().text(),
  ];
  const rawPrice = priceCandidates.find((t) => /\d/.test(t)) || "";
  const { value: priceNum, currency } = parsePrice(rawPrice);

  // ---- IMAGE ----
  let imageUrl = "";
  const imgCandidates: string[] = [
    jsonLdImage,
    $('[itemprop="image"]').attr("src") || $('[itemprop="image"]').attr("content") || "",
    $('meta[property="og:image"]').attr("content") || "",
    $('[class*="product-image"] img').first().attr("src") || "",
    $('[class*="gallery-main"] img').first().attr("src") || "",
    $(".product-photo img, .product-image img, #mainImage img").first().attr("src") || "",
  ];
  for (const c of imgCandidates) {
    if (c && c.trim().length > 10) {
      imageUrl = c.trim();
      if (!imageUrl.startsWith("http")) {
        try { imageUrl = new URL(imageUrl, url).href; } catch {}
      }
      break;
    }
  }

  // ---- AVAILABILITY ----
  const availCandidates = [
    $('[class*="availability"]').first().text(),
    $('[class*="stock"]').first().text(),
    $('[itemprop="availability"]').attr("content") || $('[itemprop="availability"]').text(),
  ];
  const availability = availCandidates.find((t) => t.trim().length > 1)?.trim() || "";

  // ---- SPECS ----
  const specMap: Record<string, string> = {};

  // DL/table patterns
  $("table.specifications tr, table.params tr, table.product-params tr").each((_, row) => {
    const cells = $(row).find("td, th");
    if (cells.length >= 2) {
      const label = $(cells[0]).text().trim().toLowerCase();
      const val = $(cells[1]).text().trim();
      if (label && val) specMap[label] = val;
    }
  });

  $("dl dt").each((_, dt) => {
    const label = $(dt).text().trim().toLowerCase();
    const val = $(dt).next("dd").text().trim();
    if (label && val) specMap[label] = val;
  });

  $('[class*="spec"], [class*="param"], [class*="vlastnost"], [class*="techspec"]').each((_, el) => {
    const children = $(el).children();
    if (children.length >= 2) {
      const label = $(children[0]).text().trim().toLowerCase();
      const val = $(children[1]).text().trim();
      if (label && val) specMap[label] = val;
    }
  });

  const allText = $("body").text().replace(/\s+/g, " ");

  const findSpec = (keys: string[]): string => {
    for (const k of keys) {
      for (const [label, val] of Object.entries(specMap)) {
        if (label.includes(k.toLowerCase())) return val;
      }
    }
    for (const k of keys) {
      const rx = new RegExp(k + "[:\\s]+([^\\n,<]{3,60})", "i");
      const m = allText.match(rx);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return "";
  };

  const processor = findSpec(["procesor", "processor", "cpu", "intel core", "amd ryzen", "apple m"]);
  const ram = findSpec(["ram", "pamäť ram", "operačná pamäť", "paměť ram", "memory"]);
  const storageVal = findSpec(["disk", "úložisko", "storage", "ssd", "hdd", "pevný disk"]);
  const gpu = findSpec(["grafika", "grafická karta", "gpu", "graphics card", "nvidia", "radeon"]);
  const display = findSpec(["displej", "display", "obrazovka", "uhlopriečka", "diagonal"]);
  const os = findSpec(["operačný systém", "os", "windows", "linux", "macos"]);
  const weight = findSpec(["hmotnosť", "váha", "weight"]);
  const battery = findSpec(["batéria", "battery", "výdrž batérie", "akkumulátor"]);

  const finalName = (jsonLdName && jsonLdName.length > 3) ? jsonLdName : name;
  const finalImageUrl = imageUrl;
  const finalPrice = jsonLdPrice
    ? parsePrice(jsonLdPrice + (jsonLdCurrency === "CZK" ? " Kč" : " €"))
    : { value: priceNum, currency };
  const displayPrice = rawPrice.trim() || (finalPrice.value ? `${finalPrice.value} ${finalPrice.currency}` : "");

  return {
    url,
    name: finalName,
    brand: extractBrand(finalName),
    price: displayPrice,
    priceNumeric: finalPrice.value ? Math.round(finalPrice.value) : null,
    currency: finalPrice.currency,
    processor,
    ram,
    storage: storageVal,
    gpu,
    display,
    os,
    weight,
    battery,
    imageUrl: finalImageUrl,
    eshopName: extractEshopName(url),
    availability,
    rawData: null,
    sessionId: "",
    fetchedAt: new Date().toISOString(),
  };
}

function extractBrand(name: string): string {
  const brands = ["Apple", "Dell", "HP", "Lenovo", "Asus", "Acer", "MSI", "Samsung", "Toshiba", "Huawei", "Microsoft", "Razer", "LG"];
  const upper = name.toUpperCase();
  return brands.find((b) => upper.includes(b.toUpperCase())) || "";
}

function scoreComputer(c: any): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (c.priceNumeric && c.priceNumeric > 0) score += 10;

  const proc = (c.processor || "").toLowerCase();
  if (proc.includes("i9") || proc.includes("ryzen 9") || proc.includes("m3 pro") || proc.includes("m3 max")) {
    score += 30; reasons.push("Výkonný procesor");
  } else if (proc.includes("i7") || proc.includes("ryzen 7") || proc.includes("m2 pro") || proc.includes("m3")) {
    score += 25; reasons.push("Dobrý procesor");
  } else if (proc.includes("i5") || proc.includes("ryzen 5") || proc.includes("m2") || proc.includes("m1")) {
    score += 18; reasons.push("Štandardný procesor");
  } else if (proc.includes("i3") || proc.includes("celeron") || proc.includes("pentium")) {
    score += 8;
  }

  const ram = c.ram || "";
  const ramMatch = ram.match(/(\d+)\s*GB/i);
  if (ramMatch) {
    const gb = parseInt(ramMatch[1]);
    if (gb >= 32) { score += 20; reasons.push(`Veľká RAM (${gb} GB)`); }
    else if (gb >= 16) { score += 15; reasons.push(`Dostatočná RAM (${gb} GB)`); }
    else if (gb >= 8) { score += 10; }
    else { score += 4; }
  }

  const st = (c.storage || "").toLowerCase();
  if (st.includes("ssd")) { score += 10; reasons.push("SSD úložisko"); }
  const stMatch = (c.storage || "").match(/(\d+)\s*(GB|TB)/i);
  if (stMatch) {
    const sz = parseInt(stMatch[1]);
    const isTB = stMatch[2].toUpperCase() === "TB";
    const gb = isTB ? sz * 1024 : sz;
    if (gb >= 1000) { score += 8; }
    else if (gb >= 512) { score += 5; }
  }

  const gpu = (c.gpu || "").toLowerCase();
  if (gpu.includes("rtx 40") || gpu.includes("rtx 4")) { score += 20; reasons.push("Výkonná grafická karta"); }
  else if (gpu.includes("rtx 30") || gpu.includes("rtx 3")) { score += 15; reasons.push("Dobrá grafická karta"); }
  else if (gpu.includes("rtx") || gpu.includes("gtx") || gpu.includes("radeon rx")) { score += 10; }

  return { score, reasons };
}

export function registerRoutes(server: Server, app: Express) {
  app.post("/api/fetch-computer", async (req, res) => {
    const { url, sessionId } = req.body;
    if (!url || !sessionId) {
      return res.status(400).json({ error: "Chýba URL alebo sessionId" });
    }
    try {
      const data = await scrapeComputer(url);
      data.sessionId = sessionId;
      const saved = storage.saveComputer(data);
      res.json(saved);
    } catch (err: any) {
      console.error("Scrape error:", err.message);
      // Return partial data even on error so the UI shows something useful
      const fallback: InsertComputer = {
        url,
        name: "Produkt (nepodarilo sa načítať)",
        brand: "",
        price: "",
        priceNumeric: null,
        currency: "€",
        processor: "",
        ram: "",
        storage: "",
        gpu: "",
        display: "",
        os: "",
        weight: "",
        battery: "",
        imageUrl: "",
        eshopName: extractEshopName(url),
        availability: "Chyba načítania",
        rawData: null,
        sessionId,
        fetchedAt: new Date().toISOString(),
      };
      const saved = storage.saveComputer(fallback);
      res.json({ ...saved, warning: err.message });
    }
  });

  app.get("/api/computers/:sessionId", (req, res) => {
    const computers = storage.getComputersBySession(req.params.sessionId);
    res.json(computers);
  });

  app.delete("/api/computers/:sessionId", (req, res) => {
    storage.deleteComputersBySession(req.params.sessionId);
    res.json({ ok: true });
  });

  app.get("/api/recommendation/:sessionId", (req, res) => {
    const computers = storage.getComputersBySession(req.params.sessionId);
    if (computers.length === 0) return res.json(null);

    const scored = computers.map((c) => ({ ...c, ...scoreComputer(c) }));
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const withPrice = scored.filter((c) => c.priceNumeric && c.priceNumeric > 0);
    let bestValue = null;
    if (withPrice.length > 1) {
      bestValue = withPrice.reduce((best, c) =>
        c.score / c.priceNumeric! > best.score / best.priceNumeric! ? c : best
      );
    }

    res.json({ best, bestValue, ranked: scored });
  });
}
