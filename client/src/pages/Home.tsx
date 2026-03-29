import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Computer } from "@shared/schema";
import {
  Monitor, Cpu, MemoryStick, HardDrive, Zap, Globe, Trash2,
  Plus, Search, Star, TrendingUp, Award, X, ChevronDown, ChevronUp,
  ShoppingCart, Sun, Moon, Check
} from "lucide-react";

// ---- Session ID (in-memory only) ----
const SESSION_ID = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;

// ---- Theme toggle ----
function useTheme() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

// ---- Spec rows config ----
const SPEC_ROWS = [
  { key: "processor", label: "Procesor", icon: Cpu },
  { key: "ram", label: "RAM", icon: MemoryStick },
  { key: "storage", label: "Úložisko", icon: HardDrive },
  { key: "gpu", label: "Grafická karta", icon: Zap },
  { key: "display", label: "Displej", icon: Monitor },
  { key: "os", label: "Operačný systém", icon: Globe },
  { key: "weight", label: "Hmotnosť", icon: Globe },
  { key: "battery", label: "Batéria", icon: Zap },
];

type ScoreData = {
  score: number;
  reasons: string[];
};

type RankedComputer = Computer & ScoreData;

type Recommendation = {
  best: RankedComputer;
  bestValue: RankedComputer | null;
  ranked: RankedComputer[];
};

// ---- Helper: score color ----
function scoreClass(score: number) {
  if (score >= 50) return "score-high";
  if (score >= 25) return "score-mid";
  return "score-low";
}

// ---- URL Card Input ----
function UrlInput({
  index, value, onChange, onRemove, canRemove, loading
}: {
  index: number; value: string; onChange: (v: string) => void;
  onRemove: () => void; canRemove: boolean; loading: boolean;
}) {
  return (
    <div className="flex gap-2 items-center" data-testid={`url-input-row-${index}`}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
        {index + 1}
      </div>
      <Input
        data-testid={`input-url-${index}`}
        placeholder={`https://alza.sk/... alebo https://mall.sk/...`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className="flex-1 font-mono text-xs"
      />
      {canRemove && (
        <button
          data-testid={`btn-remove-url-${index}`}
          onClick={onRemove}
          disabled={loading}
          className="text-muted-foreground hover:text-destructive transition-colors p-1"
          title="Odstrániť"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

// ---- Computer Card (header in comparison) ----
function ComputerHeader({ pc, isBest, rank }: { pc: Computer; isBest: boolean; rank: number }) {
  return (
    <div className={`p-4 rounded-t-lg flex flex-col gap-2 ${isBest ? "col-best-header" : "bg-muted"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 rank-${Math.min(rank, 3)}`}>
          {rank}
        </div>
        {isBest && (
          <Badge className="bg-white/20 text-white border-white/30 text-xs">
            <Award size={10} className="mr-1" /> Najlepší výber
          </Badge>
        )}
      </div>
      {pc.imageUrl && (
        <div className="flex justify-center py-2">
          <img
            src={pc.imageUrl}
            alt={pc.name || ""}
            className="max-h-24 max-w-full object-contain rounded"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      )}
      <div>
        <p className={`text-xs font-semibold uppercase tracking-wide ${isBest ? "text-white/70" : "text-muted-foreground"}`}>
          {pc.eshopName}
        </p>
        <p className={`text-sm font-bold leading-tight mt-0.5 line-clamp-3 ${isBest ? "text-white" : "text-foreground"}`} title={pc.name || ""}>
          {pc.name || "Neznámy produkt"}
        </p>
      </div>
      <div className="mt-1">
        {pc.price ? (
          <span className={`text-xl font-extrabold ${isBest ? "text-white" : "text-primary"}`}>
            {pc.price.replace(/\s+/g, " ").trim()}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Cena neuvedená</span>
        )}
      </div>
      {pc.availability && (
        <p className={`text-xs ${isBest ? "text-white/80" : "text-muted-foreground"}`}>
          {pc.availability}
        </p>
      )}
    </div>
  );
}

// ---- Main Page ----
export default function Home() {
  const { dark, toggle } = useTheme();
  const [urls, setUrls] = useState(["", ""]);
  const [isComparing, setIsComparing] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const resultsRef = useRef<HTMLDivElement>(null);

  // Fetched computers
  const { data: computers = [], isLoading: loadingComputers } = useQuery<Computer[]>({
    queryKey: ["/api/computers", SESSION_ID],
    queryFn: () => apiRequest("GET", `/api/computers/${SESSION_ID}`).then((r) => r.json()),
    enabled: isComparing,
    refetchInterval: false,
  });

  // Recommendation
  const { data: recommendation, isLoading: loadingRec } = useQuery<Recommendation | null>({
    queryKey: ["/api/recommendation", SESSION_ID],
    queryFn: () => apiRequest("GET", `/api/recommendation/${SESSION_ID}`).then((r) => r.json()),
    enabled: isComparing && computers.length > 0,
  });

  // Fetch mutation
  const fetchMutation = useMutation({
    mutationFn: ({ url }: { url: string }) =>
      apiRequest("POST", "/api/fetch-computer", { url, sessionId: SESSION_ID }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/computers", SESSION_ID] });
      qc.invalidateQueries({ queryKey: ["/api/recommendation", SESSION_ID] });
    },
    onError: (err: any) => {
      toast({ title: "Chyba", description: err.message || "Nepodarilo sa načítať stránku", variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/computers/${SESSION_ID}`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/computers", SESSION_ID] });
      qc.invalidateQueries({ queryKey: ["/api/recommendation", SESSION_ID] });
      setIsComparing(false);
      setUrls(["", ""]);
    },
  });

  const handleAddUrl = () => {
    if (urls.length < 5) setUrls([...urls, ""]);
  };

  const handleRemoveUrl = (i: number) => {
    setUrls(urls.filter((_, idx) => idx !== i));
  };

  const handleCompare = async () => {
    const validUrls = urls.filter((u) => u.trim().length > 5);
    if (validUrls.length < 2) {
      toast({ title: "Aspoň 2 linky", description: "Zadajte aspoň 2 URL adresy na porovnanie.", variant: "destructive" });
      return;
    }

    // Clear previous
    await apiRequest("DELETE", `/api/computers/${SESSION_ID}`);
    qc.invalidateQueries({ queryKey: ["/api/computers", SESSION_ID] });

    setIsComparing(true);

    // Fetch all in parallel
    await Promise.allSettled(validUrls.map((url) => fetchMutation.mutateAsync({ url })));

    // Scroll to results
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 300);
  };

  const isPending = fetchMutation.isPending;
  const rankedMap = new Map<number, number>();
  (recommendation?.ranked || []).forEach((pc, i) => rankedMap.set(pc.id, i + 1));
  const bestId = recommendation?.best?.id;
  const bestValueId = recommendation?.bestValue?.id;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-50 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* SVG Logo */}
            <svg aria-label="PC Komparátor" width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="7" className="fill-primary" />
              <rect x="5" y="8" width="22" height="13" rx="2.5" stroke="white" strokeWidth="1.8" />
              <rect x="12" y="21" width="8" height="2" fill="white" rx="0.5" />
              <rect x="10" y="23" width="12" height="1.5" fill="white" rx="0.5" />
              <path d="M10 14l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="text-base font-extrabold tracking-tight text-foreground leading-tight">PC Komparátor</h1>
              <p className="text-xs text-muted-foreground leading-none hidden sm:block">Porovnanie počítačov z e-shopov</p>
            </div>
          </div>
          <button
            data-testid="btn-theme-toggle"
            onClick={toggle}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={dark ? "Svetlý režim" : "Tmavý režim"}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* Hero section */}
        <section className="mb-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-foreground mb-2 tracking-tight">
            Porovnajte počítače z e-shopov
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto text-sm">
            Vložte 2 až 5 URL liniek z ľubovoľných slovenských alebo českých e-shopov. Automaticky načítame parametre a odporučíme najlepší počítač.
          </p>
        </section>

        {/* URL inputs */}
        <Card className="mb-6 shadow-md">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe size={16} className="text-primary" />
              URL adresy produktov
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {urls.map((url, i) => (
              <UrlInput
                key={i}
                index={i}
                value={url}
                onChange={(v) => {
                  const next = [...urls];
                  next[i] = v;
                  setUrls(next);
                }}
                onRemove={() => handleRemoveUrl(i)}
                canRemove={urls.length > 2}
                loading={isPending}
              />
            ))}

            <div className="flex flex-wrap gap-2 pt-2">
              {urls.length < 5 && (
                <Button
                  data-testid="btn-add-url"
                  variant="outline"
                  size="sm"
                  onClick={handleAddUrl}
                  disabled={isPending}
                  className="gap-1"
                >
                  <Plus size={14} /> Pridať URL ({urls.length}/5)
                </Button>
              )}
              <Button
                data-testid="btn-compare"
                onClick={handleCompare}
                disabled={isPending}
                className="gap-2 ml-auto"
                size="sm"
              >
                {isPending ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Načítavam…
                  </>
                ) : (
                  <>
                    <Search size={14} />
                    Porovnať počítače
                  </>
                )}
              </Button>
            </div>

            {isPending && (
              <p className="text-xs text-muted-foreground animate-pulse">
                Načítavam e-shopy… Môže to trvať niekoľko sekúnd.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        <div ref={resultsRef}>
          {isComparing && (loadingComputers || isPending) && computers.length === 0 && (
            <LoadingSkeleton count={urls.filter(u => u.trim().length > 5).length} />
          )}

          {computers.length > 0 && (
            <>
              {/* Recommendation banner */}
              {recommendation && !loadingRec && (
                <RecommendationBanner rec={recommendation} />
              )}

              {/* Comparison table */}
              <ComparisonTable
                computers={computers}
                bestId={bestId}
                bestValueId={bestValueId}
                rankedMap={rankedMap}
              />

              {/* Ranked list */}
              {recommendation && !loadingRec && (
                <RankedList ranked={recommendation.ranked} bestId={bestId} bestValueId={bestValueId} />
              )}

              <div className="flex justify-center mt-6">
                <Button
                  data-testid="btn-reset"
                  variant="outline"
                  size="sm"
                  onClick={() => deleteMutation.mutate()}
                  className="gap-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 size={14} /> Vymazať a začať odznova
                </Button>
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="border-t border-border mt-12 py-6 text-center text-xs text-muted-foreground">
        PC Komparátor — automaticky načítava parametre z e-shopov. Ceny sú informatívne.
      </footer>
    </div>
  );
}

// ---- Loading Skeleton ----
function LoadingSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: `repeat(${Math.min(count, 4)}, minmax(0, 1fr))` }}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="h-36 w-full" />
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-6 w-1/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---- Recommendation Banner ----
function RecommendationBanner({ rec }: { rec: Recommendation }) {
  const { best, bestValue } = rec;
  const sameAsValue = bestValue?.id === best.id;

  return (
    <div className="mb-6 grid sm:grid-cols-2 gap-4">
      <Card className="border-2 border-primary bg-accent shadow-md">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Award size={18} className="text-primary" />
            <span className="text-sm font-bold text-primary">Najlepší celkový výber</span>
          </div>
          <p className="font-semibold text-foreground text-sm line-clamp-2">{best.name}</p>
          {best.price && <p className="text-primary font-bold mt-1">{best.price}</p>}
          {best.reasons && best.reasons.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {best.reasons.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                  <Check size={10} className="text-primary flex-shrink-0" /> {r}
                </li>
              ))}
            </ul>
          )}
          <a href={best.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <ShoppingCart size={12} /> Prejsť do e-shopu
          </a>
        </CardContent>
      </Card>

      {!sameAsValue && bestValue && (
        <Card className="border-2 border-yellow-400 dark:border-yellow-600 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={18} className="text-yellow-600 dark:text-yellow-400" />
              <span className="text-sm font-bold text-yellow-700 dark:text-yellow-400">Najlepší pomer cena/výkon</span>
            </div>
            <p className="font-semibold text-foreground text-sm line-clamp-2">{bestValue.name}</p>
            {bestValue.price && <p className="text-yellow-700 dark:text-yellow-400 font-bold mt-1">{bestValue.price}</p>}
            {bestValue.reasons && bestValue.reasons.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {bestValue.reasons.map((r, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                    <Check size={10} className="text-yellow-600 flex-shrink-0" /> {r}
                  </li>
                ))}
              </ul>
            )}
            <a href={bestValue.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-yellow-700 dark:text-yellow-400 hover:underline">
              <ShoppingCart size={12} /> Prejsť do e-shopu
            </a>
          </CardContent>
        </Card>
      )}

      {sameAsValue && (
        <Card className="border border-border bg-muted/40">
          <CardContent className="p-4 flex items-center justify-center h-full">
            <div className="text-center">
              <Star size={24} className="text-yellow-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Odporúčaný počítač je zároveň<br />najlepší pomer cena/výkon.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Comparison Table ----
function ComparisonTable({
  computers, bestId, bestValueId, rankedMap
}: {
  computers: Computer[];
  bestId?: number;
  bestValueId?: number | null;
  rankedMap: Map<number, number>;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Card className="mb-6 overflow-hidden shadow-md">
      <CardHeader className="pb-0 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Monitor size={15} className="text-primary" /> Porovnanie parametrov
        </CardTitle>
        <button
          data-testid="btn-toggle-table"
          onClick={() => setCollapsed((c) => !c)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </CardHeader>

      {!collapsed && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full compare-table text-sm" style={{ minWidth: `${computers.length * 200 + 140}px` }}>
            <thead>
              <tr>
                <th className="compare-table w-36 sticky left-0 z-10 bg-muted">Parameter</th>
                {computers.map((pc) => {
                  const rank = rankedMap.get(pc.id) || 99;
                  const isBest = pc.id === bestId;
                  return (
                    <th
                      key={pc.id}
                      className={`compare-table min-w-[200px] ${isBest ? "col-best-header" : ""}`}
                    >
                      <ComputerHeader pc={pc} isBest={isBest} rank={rank} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {SPEC_ROWS.map(({ key, label, icon: Icon }) => (
                <tr key={key} className="hover:bg-muted/40 transition-colors">
                  <td className="sticky left-0 z-10 bg-background border-b border-border">
                    <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs py-1">
                      <Icon size={13} /> {label}
                    </div>
                  </td>
                  {computers.map((pc) => {
                    const val = (pc as any)[key];
                    const isBest = pc.id === bestId;
                    return (
                      <td key={pc.id} className={isBest ? "col-best" : ""}>
                        {val ? (
                          <span className="text-foreground">{val}</span>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs italic">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Price row */}
              <tr className="bg-muted/20">
                <td className="sticky left-0 z-10 bg-background border-b border-border">
                  <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs py-1">
                    <ShoppingCart size={13} /> Cena
                  </div>
                </td>
                {computers.map((pc) => {
                  const isBest = pc.id === bestId;
                  const isValue = pc.id === bestValueId;
                  return (
                    <td key={pc.id} className={isBest ? "col-best" : ""}>
                      <div className="flex items-center gap-1 flex-wrap">
                        {pc.price ? (
                          <span className={`font-bold ${isBest ? "text-primary" : "text-foreground"}`}>
                            {pc.price}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50 text-xs italic">—</span>
                        )}
                        {isValue && !isBest && (
                          <Badge variant="outline" className="text-xs border-yellow-400 text-yellow-700 dark:text-yellow-400 py-0">
                            <TrendingUp size={9} className="mr-0.5" /> Hodnota
                          </Badge>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* Link row */}
              <tr>
                <td className="sticky left-0 z-10 bg-background">
                  <div className="flex items-center gap-2 text-muted-foreground font-medium text-xs py-1">
                    <Globe size={13} /> E-shop
                  </div>
                </td>
                {computers.map((pc) => {
                  const isBest = pc.id === bestId;
                  return (
                    <td key={pc.id} className={isBest ? "col-best" : ""}>
                      <a
                        href={pc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <ShoppingCart size={11} />
                        Kúpiť na {pc.eshopName}
                      </a>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Ranked List ----
function RankedList({
  ranked, bestId, bestValueId
}: {
  ranked: RankedComputer[];
  bestId?: number;
  bestValueId?: number | null;
}) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
        <Star size={14} className="text-primary" /> Výsledkový rebríček
      </h3>
      <div className="space-y-3">
        {ranked.map((pc, i) => {
          const rank = i + 1;
          const isBest = pc.id === bestId;
          const isValue = pc.id === bestValueId;
          return (
            <Card
              key={pc.id}
              data-testid={`ranked-card-${pc.id}`}
              className={`${isBest ? "border-2 border-primary shadow-md" : "border border-border"} transition-all`}
            >
              <CardContent className="p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                {/* Rank */}
                <div className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-black rank-${Math.min(rank, 3)}`}>
                  {rank}
                </div>

                {/* Image */}
                {pc.imageUrl && (
                  <img
                    src={pc.imageUrl}
                    alt={pc.name || ""}
                    className="w-16 h-16 object-contain rounded flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground font-semibold uppercase">{pc.eshopName}</span>
                    {isBest && <Badge className="text-xs bg-primary text-primary-foreground"><Award size={9} className="mr-1" />Najlepší</Badge>}
                    {isValue && !isBest && <Badge variant="outline" className="text-xs border-yellow-400 text-yellow-700 dark:text-yellow-400"><TrendingUp size={9} className="mr-1" />Hodnota</Badge>}
                  </div>
                  <p className="text-sm font-semibold text-foreground leading-tight line-clamp-2" title={pc.name || ""}>{pc.name}</p>

                  {/* Key specs */}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                    {pc.processor && <span className="flex items-center gap-1"><Cpu size={10} />{pc.processor}</span>}
                    {pc.ram && <span className="flex items-center gap-1"><MemoryStick size={10} />{pc.ram}</span>}
                    {pc.storage && <span className="flex items-center gap-1"><HardDrive size={10} />{pc.storage}</span>}
                  </div>

                  {pc.reasons && pc.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {pc.reasons.map((r, ri) => (
                        <Badge key={ri} variant="secondary" className="text-xs py-0">{r}</Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Price + score */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0 sm:text-right">
                  {pc.price && (
                    <span className="text-lg font-extrabold text-primary whitespace-nowrap">{pc.price}</span>
                  )}
                  <Badge className={`text-xs ${scoreClass(pc.score)}`} variant="outline">
                    Skóre: {pc.score}
                  </Badge>
                  <a
                    href={pc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                  >
                    <ShoppingCart size={11} /> Kúpiť
                  </a>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
